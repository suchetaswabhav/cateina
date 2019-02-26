/**
 * Copyright (c) 2002-2017 "Neo Technology,","
 * Network Engine for Objects in Lund AB [http://neotechnology.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var childProcess = require('child_process');
var Mustache = require('mustache');
var fs = require('fs');
var tmp = require('tmp');

var BoltKit = function (verbose) {
  this.verbose = verbose || false;
};

BoltKit.prototype.startWithTemplate = function (scriptTemplate, parameters, port) {
  var template = fs.readFileSync(scriptTemplate, 'utf-8');
  var scriptContents = Mustache.render(template, parameters);
  var script = tmp.fileSync().name;
  fs.writeFileSync(script, scriptContents, 'utf-8');
  return this.start(script, port);
};

BoltKit.prototype.start = function(script, port) {
  var spawn = childProcess.spawn, server, code = -1;

  server = spawn('/usr/local/bin/boltstub', ['-v', port, script]);
  if (this.verbose) {
    server.stdout.on('data', (data) => {
      console.log(`${data}`);
    });
    server.stderr.on('data', (data) => {
      console.log(`${data}`);
    });
    server.on('end', function (data) {
      console.log(data);
    });
  }

  server.on('close', function (c) {
    code = c;
  });

  server.on('error', function (err) {
    console.log('Failed to start child process:' + err);
  });

  var Server = function(){};
  //give process some time to exit
  Server.prototype.exit = function(callback) {setTimeout(function(){callback(code);}, 1000)};

  return new Server();
};

//Make sure boltstub is started before running
//user code
BoltKit.prototype.run = function(callback) {
  setTimeout(callback, 1000);
};

function boltKitSupport() {
  try {
    var test = childProcess.spawn;
    return !!test;
  } catch (e) {
    return false;
  }
}

module.exports = {
  BoltKit: BoltKit,
  BoltKitSupport: boltKitSupport()
};

