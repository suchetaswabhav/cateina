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

var neo4jv1 = require("../../lib/v1");

/**
* The tests below are examples that get pulled into the Driver Manual using the tags inside the tests.
*
* DO NOT add tests to this file that are not for that exact purpose.
* DO NOT modify these tests without ensuring they remain consistent with the equivalent examples in other drivers
*/
describe('examples', function() {

  var driverGlobal;
  var console;
  var originalTimeout;

  var testResultPromise;
  var resolveTestResultPromise;

  beforeAll(function () {
    var neo4j = neo4jv1;
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

    //tag::construct-driver[]
    var driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "neo4j"));
    //end::construct-driver[]
    driverGlobal = driver;
  });

  beforeEach(function(done) {

    testResultPromise = new Promise(function (resolve, reject) {
      resolveTestResultPromise = resolve;
    });

    // Override console.log, to assert on stdout output
    console = {log: resolveTestResultPromise};

    var session = driverGlobal.session();
    session.run("MATCH (n) DETACH DELETE n").then(function () {
      session.close();
      done();
    });
  });

  afterAll(function() {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    driverGlobal.close();
  });

  it('should document a minimal import and usage example', function (done) {
    //OH my is this a hack
    var require = function (arg) {
      return {v1: neo4jv1}
    };
    // tag::minimal-example-import[]
    var neo4j = require('neo4j-driver').v1;
    // end::minimal-example-import[]
    // tag::minimal-example[]
    var driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "neo4j"));
    var session = driver.session();
    session
      .run( "CREATE (a:Person {name: {name}, title: {title}})", {name: "Arthur", title: "King"})
      .then( function()
      {
        return session.run( "MATCH (a:Person) WHERE a.name = {name} RETURN a.name AS name, a.title AS title",
            {name: "Arthur"})
      })
      .then( function( result ) {
        console.log( result.records[0].get("title") + " " + result.records[0].get("name") );
        session.close();
        driver.close();
      });
    // end::minimal-example[]

    testResultPromise.then(function (loggedMsg) {
      expect(loggedMsg).toBe("King Arthur");
      done();
    });
  });

  it('should be able to configure connection pool size', function (done) {
   var neo4j = neo4jv1;
    // tag::configuration[]
    var driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "neo4j"), {connectionPoolSize: 50});
    //end::configuration[]

    var s = driver.session();
    s.run( "CREATE (p:Person {name: {name}})", {name: "The One"} )
      .then( function(result) {
        var theOnesCreated = result.summary.counters.nodesCreated();
        console.log(theOnesCreated);
        s.close();
        driver.close();
      });

    testResultPromise.then(function (loggedCount) {
      expect(loggedCount).toBe(1);
      done();
    });
  });

  it('should be able to configure maximum transaction retry time', function () {
    var neo4j = neo4jv1;
    // tag::configuration-transaction-retry-time[]
    var maxRetryTimeMs = 45 * 1000; // 45 seconds
    var driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'neo4j'), {maxTransactionRetryTime: maxRetryTimeMs});
    //end::configuration-transaction-retry-time[]

    var session = driver.session();
    expect(session._transactionExecutor._maxRetryTimeMs).toBe(maxRetryTimeMs);
  });

  it('should document a statement', function(done) {
    var session = driverGlobal.session();
    // tag::statement[]
    session
      .run( "CREATE (person:Person {name: {name}})", {name: "Arthur"} )
    // end::statement[]
      .then( function(result) {
        var theOnesCreated = result.summary.counters.nodesCreated();
        console.log("There were " + theOnesCreated + " the ones created.");
        session.close();
      });

    testResultPromise.then(function (loggedMsg) {
      expect(loggedMsg).toBe("There were 1 the ones created.");
      done();
    });
  });

  it('should document a statement without parameters', function(done) {
    var session = driverGlobal.session();
    // tag::statement-without-parameters[]
    session
      .run( "CREATE (p:Person {name: 'Arthur'})" )
    // end::statement-without-parameters[]
      .then( function(result) {
        var theOnesCreated = result.summary.counters.nodesCreated();
        console.log("There were " + theOnesCreated + " the ones created.");
        session.close();
      });

    // Then
    testResultPromise.then(function(loggedMsg){
      expect(loggedMsg).toBe("There were 1 the ones created.");
      done();
    });
  });

  it('should be able to iterate results', function(done) {
    var session = driverGlobal.session();
    session
      .run( "CREATE (weapon:Weapon {name: {name}})", {name: "Sword in the stone"} )
      .then(function() {
    // tag::result-traversal[]
      var searchTerm = "Sword";
      session
        .run( "MATCH (weapon:Weapon) WHERE weapon.name CONTAINS {term} RETURN weapon.name", {term: searchTerm} )
        .subscribe({
          onNext: function(record) {
            console.log("" + record.get("weapon.name"));
          },
          onCompleted: function() {
            session.close();
          },
          onError: function(error) {
            console.log(error);
          }
        });
    // end::result-traversal[]
    });

    // Then
    testResultPromise.then(function(loggedMsg){
      expect(loggedMsg).toBe("Sword in the stone");
      done();
    });
  });

  it('should be able to access records', function(done) {
    var session = driverGlobal.session();
    session
      .run( "CREATE (weapon:Weapon {name: {name}, owner: {owner}, material: {material}, size: {size}})",
          {name: "Sword in the stone", owner: "Arthur", material: "Stone", size: "Huge"})
      .then(function() {
      // tag::access-record[]
        var searchTerm = "Arthur";
        session
          .run( "MATCH (weapon:Weapon) WHERE weapon.owner CONTAINS {term} RETURN weapon.name, weapon.material, weapon.size",
              {term: searchTerm} )
          .subscribe({
            onNext: function(record) {
              var sword = [];
              record.forEach(function(value, key)
              {
                sword.push(key + ": " + value);
              });
              console.log(sword);
            },
            onCompleted: function() {
              session.close();
            },
            onError: function(error) {
              console.log(error);
            }
          });
      // end::access-record[]
      });

    // Then
    testResultPromise.then(function(loggedCount){
      expect(loggedCount.length).toBe(3);
      done();
    });
  });

  it('should be able to retain for later processing', function(done) {
    var session = driverGlobal.session();

    session
    .run("CREATE (knight:Person:Knight {name: {name}, castle: {castle}})", {name: "Lancelot", castle: "Camelot"})
    .then(function() {
      // tag::retain-result[]
      session
        .run("MATCH (knight:Person:Knight) WHERE knight.castle = {castle} RETURN knight.name AS name",
            {castle: "Camelot"})
        .then(function (result) {
          var records = [];
          for (var i = 0; i < result.records.length; i++) {
            records.push(result.records[i]);
          }
          return records;
        })
        .then(function (records) {
          for(var i = 0; i < records.length; i ++) {
            console.log(records[i].get("name") + " is a knight of Camelot");
          }
          session.close();

        });
      // end::retain-result[]
    });

    testResultPromise.then(function(loggedMsg){
      expect(loggedMsg).toBe("Lancelot is a knight of Camelot");
      done();
    });
  });

  it('should be able to do nested queries', function(done) {
    var session = driverGlobal.session();
    session
      .run( "CREATE (knight:Person:Knight {name: {name1}, castle: {castle}})" +
            "CREATE (king:Person {name: {name2}, title: {title}})",
          {name1: "Lancelot", castle: "Camelot", name2: "Arthur", title: "King"})
      .then(function() {
        // tag::nested-statements[]
          session
            .run("MATCH (knight:Person:Knight) WHERE knight.castle = {castle} RETURN id(knight) AS knight_id",
                {castle: "Camelot"})
            .subscribe({
              onNext: function(record) {
                session
                  .run("MATCH (knight) WHERE id(knight) = {id} MATCH (king:Person) WHERE king.name = {king} CREATE (knight)-[:DEFENDS]->(king)",
                  {id: record.get("knight_id"), king: "Arthur"});
              },
              onCompleted: function() {
                session
                  .run("MATCH (:Knight)-[:DEFENDS]->() RETURN count(*)")
                  .then(function (result) {
                    console.log("Count is " + result.records[0].get(0).toInt());
                    session.close();
                  });
              },
              onError: function(error) {
                console.log(error);
              }
            });
        // end::nested-statements[]
        });

    testResultPromise.then(function(loggedMsg){
      expect(loggedMsg).toBe("Count is 1");
      done();
    });
  });

  it('should be able to handle cypher error', function(done) {
    var session = driverGlobal.session();

    // tag::handle-cypher-error[]
    session
      .run("This will cause a syntax error")
      .catch( function(err) {
        console.log(err);
        session.close();
      });
    // end::handle-cypher-error[]

    testResultPromise.then(function(loggedError){
      expect(loggedError.code).toBe( 'Neo.ClientError.Statement.SyntaxError' );
      done();
    });
  });

  it('should be able to profile', function(done) {
    var session = driverGlobal.session();

    session.run("CREATE (:Person {name: {name}})", {name: "Arthur"}).then(function() {
      // tag::result-summary-query-profile[]
      session
        .run("PROFILE MATCH (p:Person {name: {name}}) RETURN id(p)", {name: "Arthur"})
        .then(function (result) {
          console.log(result.summary.profile);
          session.close();
        });
      // end::result-summary-query-profile[]
    });

    testResultPromise.then(function (loggedMsg) {
      expect(loggedMsg).toBeDefined();
      done();
    });
  });

  it('should be able to see notifications', function(done) {
    var session = driverGlobal.session();

    // tag::result-summary-notifications[]
    session
      .run("EXPLAIN MATCH (king), (queen) RETURN king, queen")
      .then(function (result) {
        var notifications = result.summary.notifications, i;
        for (i = 0; i < notifications.length; i++) {
          console.log(notifications[i].code);
        }
        session.close();
      });
    // end::result-summary-notifications[]

    testResultPromise.then(function (loggedMsg) {
      expect(loggedMsg).toBe("Neo.ClientNotification.Statement.CartesianProductWarning");
      done();
    });
  });

  it('should document committing a transaction', function() {
    var session = driverGlobal.session();

    // tag::transaction-commit[]
    var tx = session.beginTransaction();
    tx.run( "CREATE (:Person {name: {name}})", {name: "Guinevere"} );
    tx.commit().then(function() {session.close()});
    // end::transaction-commit[]
  });

  it('should document rolling back a transaction', function() {
    var session = driverGlobal.session();

    // tag::transaction-rollback[]
    var tx = session.beginTransaction();
    tx.run( "CREATE (:Person {name: {name}})", {name: "Merlin"});
    tx.rollback().then(function() {session.close()});
    // end::transaction-rollback[]
  });

  it('should document how to require encryption', function() {
    var neo4j = neo4jv1;
    // tag::tls-require-encryption[]
    var driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "neo4j"), {
        // In NodeJS, encryption is on by default. In the web bundle, it is off.
      encrypted:"ENCRYPTION_ON"
    });
    // end::tls-require-encryption[]
    driver.close();
  });

  it('should document how to configure trust-on-first-use', function() {
    var neo4j = neo4jv1;
    // tag::tls-trust-on-first-use[]
    var driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "neo4j"), {
      // Note that trust-on-first-use is not available in the browser bundle,
      // in NodeJS, trust-all-certificates is the default trust mode. In the browser
      // it is TRUST_CUSTOM_CA_SIGNED_CERTIFICATES.
      trust: "TRUST_ON_FIRST_USE",
      encrypted:"ENCRYPTION_ON"
    });
    // end::tls-trust-on-first-use[]
    driver.close();
  });

  it('should document how to configure a trusted signing certificate', function() {
    var neo4j = neo4jv1;
    // tag::tls-signed[]
    var driver = neo4j.driver("bolt://localhost:7687", neo4j.auth.basic("neo4j", "neo4j"), {
      trust: "TRUST_CUSTOM_CA_SIGNED_CERTIFICATES",
      // Configuring which certificates to trust here is only available
      // in NodeJS. In the browser bundle the browsers list of trusted
      // certificates is used, due to technical limitations in some browsers.
      trustedCertificates : ["path/to/ca.crt"],
      encrypted:"ENCRYPTION_ON"
    });
    // end::tls-signed[]
    driver.close();
  });

  it('should document how to disable auth', function() {
    var neo4j = neo4jv1;
    // tag::connect-with-auth-disabled[]
    var driver = neo4j.driver("bolt://localhost:7687", {
      // In NodeJS, encryption is on by default. In the web bundle, it is off.
      encrypted:"ENCRYPTION_ON"
    });
    // end::connect-with-auth-disabled[]
    driver.close();
  });

});
