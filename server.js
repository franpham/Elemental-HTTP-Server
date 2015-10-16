"use strict";
var PORT = 3000;
var TESTUSER = 'tester';
var TESTPWD  = 'testing';

var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');
var querystring = require('querystring');
var cheerio = require('cheerio');

// MUST return on all async method calls and errors (response.end()) to prevent further execution;
var server = http.createServer(function(request, response) {
  var byteBuffer = '';            // collect all bytes;
  request.on('data', function(data) {  // GET POST DATA;
    byteBuffer += data;
  });
  var template = 'template.html';    // the file to be read; variable needed by upsertElement;

  request.on('end', function() {
    var buffer = byteBuffer.toString();    // convert bytes to characters;
    var urlStr = url.parse(request.url, true);
    var postData = querystring.parse(buffer);
    var urlInfo  = urlStr.query;
    var elName = postData.elName;
    var elSymbol = postData.elSymbol;
    var elANum = postData.elANum;
    var elState = postData.elState;
    var elGroup = postData.elGroup;
    var elLink = postData.elLink;

    // paths are relative to the active script, server.js; urlStr.pathname has leading '/';
    var file = urlStr.pathname === '/public/' ? 'public/index.html' : urlStr.pathname.substring(1);
    if (request.method === 'PUT' || request.method === 'POST' || request.method === 'DELETE')
      file = 'public/' + elName + '.html';    // set file since these methods route to '/elements'
    var fileExists = false;
    try {   // must check here to wrap in try, catch block;
      var stats = fs.statSync(file);
      fileExists = stats.isFile();
    }
    catch (error) {
      // DO NOT return, error is handled below depending on request.method;
    }
    if (request.method === 'GET') {     // handle GET requests;
      if (fileExists) {
        var filetype = file === 'public/css/styles.css' ? 'text/css' : 'text/html';
        response.writeHead(200, {'Content-Type': filetype});
        return response.end(fs.readFileSync(file, 'utf8'));
      }
      else {
        if (urlStr.pathname === '/') {    // REDIRECT TO /public/
          response.writeHead(301, {'Location': '/public/'});
          return response.end();
        }
        else {
          response.writeHead(404, {'Content-Type': 'text/html'});
          return response.end(fs.readFileSync('public/404.html', 'utf8'));
        }
      }
    } // PERFORM USER AUTHENTICATION;
    var auth = request.headers.authorization;
    if (!auth) {
      response.writeHead(401, {'WWW-Authenticate': 'Basic realm="Secure Area"'});
      return response.end('Not Authorized: enter your username and password.');
    }
    auth = auth.substring(6);   // remove 'Basic ';
    var decoded = (new Buffer(auth, 'base64')).toString();
    var colon = decoded.indexOf(':');
    var user = decoded.substring(0, colon);
    var pwd = decoded.substring(colon + 1);
    if (user !== TESTUSER || pwd !== TESTPWD) {
      response.writeHead(401, {'WWW-Authenticate': 'Basic realm="Secure Area"'});
      return response.end('Not Authorized: your username and/or password are incorrect.');
    }

    if (request.method === 'DELETE') {
      if (!fileExists) {
        response.writeHead(400, {'Content-Type': 'text/plain'});
        return response.end('The requested resource does not exist.');
      }
      else {
        return fs.unlink(file, function(error, data) {
          if (error) {
            response.writeHead(500, {'Content-Type': 'text/plain'});
            return response.end('A write error on the server occurred.');
          }
          else {
            response.writeHead(205, {'Content-Type': 'text/plain'});
            return response.end('File deletion succeeded.');
          }
        });
      }
    }
    else if (request.method !== 'POST' && request.method !== 'PUT') {
      response.writeHead(405, {'Content-Type': 'text/plain'});
      return response.end(request.method + ' request method is not supported.');
    }
    else if (urlStr.pathname !== '/elements') {
      response.writeHead(404, {'Content-Type': 'text/html'});
      return response.end(fs.readFileSync('public/404.html', 'utf8'));
    }

    // verify that all parameters are specified
    var isPost = request.method === 'POST';
    template = isPost ? 'template.html' : file;   // set to file if method is PUT;
    if (!elName || !elSymbol || !elANum || !elState || !elGroup || !elLink ||
      (isPost && fileExists) || (!isPost && !fileExists)) {
      var message = null;
      if (!elName || !elSymbol)
        message = !elName ? 'Name' : 'Symbol';
      else if (!elANum || !elState)
        message = !elANum ? 'Number' : 'State';
      else if (!elGroup || !elLink)
        message = !elGroup ? 'Group' : 'Link';
      response.writeHead(400, {'Content-Type': 'text/plain'});
      if (message)
        return response.end('Element ' + message + ' must be provided.');
      else
        return response.end(file + (isPost ? ' already exists.' : ' does not exist.'));
    }
    upsertElement(elName, elSymbol, elANum, elState, elGroup, file, true);
  }); // closes off request.on('end', ...);

  function upsertElement(elName, elSymbol, elANum, elState, elGroup, file, isLive) {
    var $ = {};   // read element.html or template.html;
    try {
      var data = fs.readFileSync(template, 'utf8');
      $ = cheerio.load(data);
    }
    catch(error) {
      console.log(error);
      response.writeHead(500, {'Content-Type': 'text/html'});
      return response.end('A read error on the server occurred.');
    }
    $('#elTitle').text(elName);
    $('#elName').text(elName);
    $('#elSymbol').text(elSymbol);
    $('#elANum').text(elANum.toString()); // cheerio accepts Strings only;
    $('#elState').text(elState);
    $('#elGroup').text(elGroup);
    $('#elLink').text(elName).attr('href', 'http://en.wikipedia.org/wiki/' + elName);

    var message = $.html();   // return the new content to the client;
    if (isLive) {
      response.writeHead(201, {'Content-Type': 'text/html'});
      response.end(message);    // DO NOT return to process index.html;
    }

    // write the new/ changed file to storage;
    fs.writeFile(file, message, function(error, data) {
      if (error)
        console.log('Error writing ' + file + ': ', error);
    }); // just console.log since writeFile is asynchronous so response was already sent;

    // load index.html to update it with new element link;
    message = fs.readFileSync('public/index.html', 'utf8');
    $ = cheerio.load(message);

    // update index.html only if element is not present;
    if ($('#' + elName).length === 0) {
      var link = $('<a />').attr('href', elName + '.html')
        .attr('id', elName).text(elName);
      $('#elements').append($('<li />').append(link)).append('\n');
      var size = $('#elements').children().length;
      $('#elTotal').text(size.toString());    // cheerio accepts Strings only;

      message = $.html();       // update index.html;
      fs.writeFileSync('public/index.html', message);
    } // do synchronous write since multiple requests may try to write to index.html;
  }

  /* // UNCOMMENT TO CREATE INITIAL CONTENT;
  var pt = require('periodic-table');
  var elements = pt.all();
  for (var i = 0; i < elements.length; i++) {   // generate all chemical elements;
    var val = elements[i];
    var valName = val.atomicNumber === 13 ? 'Aluminum' : val.name;
    var testFile = 'public/' + valName + '.html';
    template = testFile;               // comment out this line if creating file
    upsertElement(valName, val.symbol, val.atomicNumber, val.standardState, val.groupBlock, testFile, false);
  } // periodic-table's name for 13 is "Aluminum or Aluminium";
  */
});

server.listen(PORT, function() {
  console.log('server listening on port ' + PORT);
});
