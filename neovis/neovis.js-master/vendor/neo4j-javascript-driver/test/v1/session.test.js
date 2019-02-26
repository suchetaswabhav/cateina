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

import neo4j from '../../src/v1';
import {statementType} from '../../src/v1/result-summary';
import Session from '../../src/v1/session';
import {READ} from '../../src/v1/driver';
import {SingleConnectionProvider} from '../../src/v1/internal/connection-providers';
import FakeConnection from '../internal/fake-connection';

describe('session', () => {

  let driver;
  let session;
  let serverMetadata;
  let originalTimeout;

  beforeEach(done => {
    driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'neo4j'));
    driver.onCompleted = meta => {
      serverMetadata = meta['server'];
    };
    session = driver.session();
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

    session.run('MATCH (n) DETACH DELETE n').then(done);
  });

  afterEach(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    driver.close();
  });

  it('close should invoke callback ', done => {
    const connection = new FakeConnection();
    const session = newSessionWithConnection(connection);

    session.close(done);
  });

  it('close should invoke callback even when already closed ', done => {
    const connection = new FakeConnection();
    const session = newSessionWithConnection(connection);

    session.close(() => {
      session.close(() => {
        session.close(() => {
          done();
        });
      });
    });
  });

  it('close should be idempotent ', done => {
    const connection = new FakeConnection();
    const session = newSessionWithConnection(connection);

    session.close(() => {
      expect(connection.isReleasedOnceOnSessionClose()).toBeTruthy();

      session.close(() => {
        expect(connection.isReleasedOnceOnSessionClose()).toBeTruthy();

        session.close(() => {
          expect(connection.isReleasedOnceOnSessionClose()).toBeTruthy();
          done();
        });
      });
    });
  });

  it('should close transaction executor', done => {
    const session = newSessionWithConnection(new FakeConnection());

    let closeCalledTimes = 0;
    const transactionExecutor = session._transactionExecutor;
    const originalClose = transactionExecutor.close;
    transactionExecutor.close = () => {
      closeCalledTimes++;
      originalClose.call(transactionExecutor);
    };

    session.close(() => {
      expect(closeCalledTimes).toEqual(1);
      done();
    });
  });

  it('should be possible to close driver after closing session with failed tx ', done => {
    const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'neo4j'));
    const session = driver.session();
    const tx = session.beginTransaction();
    tx.run('INVALID QUERY').catch(() => {
      tx.rollback().catch(() => {
        session.close(() => {
          driver.close();
          done();
        });
      });
    });
  });

  it('should expose basic run/subscribe ', done => {
    // Given

    // When & Then
    const records = [];
    session.run("RETURN 1.0 AS a").subscribe({
      onNext: record => {
        records.push(record);
      },
      onCompleted: () => {
        expect(records.length).toBe(1);
        expect(records[0].get('a')).toBe(1);
        done();
      }
    });
  });

  it('should keep context in subscribe methods ', done => {
    // Given
    function MyObserver() {
      this.local = 'hello';
      const privateLocal = 'hello';
      this.onNext = function () {
        expect(privateLocal).toBe('hello');
        expect(this.local).toBe('hello');
      };
      this.onCompleted = function () {
        expect(privateLocal).toBe('hello');
        expect(this.local).toBe('hello');
        done();
      };
    }

    // When & Then
    session.run('RETURN 1.0 AS a').subscribe(new MyObserver());
  });

  it('should call observers onError on error ', done => {

    // When & Then
    session.run('RETURN 1 AS').subscribe({
      onError: error => {
        expect(error.code).toEqual('Neo.ClientError.Statement.SyntaxError');
        done();
      }
    });
  });

  it('should accept a statement object ', done => {
    // Given
    const statement = {text: 'RETURN 1 = {param} AS a', parameters: {param: 1}};

    // When & Then
    const records = [];
    session.run(statement).subscribe({
      onNext: record => {
        records.push(record);
      },
      onCompleted: () => {
        expect(records.length).toBe(1);
        expect(records[0].get('a')).toBe(true);
        done();
      }
    });
  });

  it('should expose run/then/then/then ', done => {
    // When & Then
    session.run("RETURN 1.0 AS a")
      .then(
        result => {
          expect(result.records.length).toBe(1);
          expect(result.records[0].get('a')).toBe(1);
          return result
        }
      ).then(
      result => {
        expect(result.records.length).toBe(1);
        expect(result.records[0].get('a')).toBe(1);
      }
    ).then(done);
  });

  it('should expose basic run/catch ', done => {
    // When & Then
    session.run('RETURN 1 AS').catch(
      error => {
        expect(error.code).toEqual('Neo.ClientError.Statement.SyntaxError');
        done();
      }
    )
  });

  it('should expose summarize method for basic metadata ', done => {
    // Given
    const statement = 'CREATE (n:Label {prop:{prop}}) RETURN n';
    const params = {prop: 'string'};
    // When & Then
    session.run(statement, params)
      .then(result => {
        const sum = result.summary;
        expect(sum.statement.text).toBe(statement);
        expect(sum.statement.parameters).toBe(params);
        expect(sum.counters.containsUpdates()).toBe(true);
        expect(sum.counters.nodesCreated()).toBe(1);
        expect(sum.statementType).toBe(statementType.READ_WRITE);
        done();
      });
  });

  it('should expose server info on successful query', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    // Given
    const statement = 'RETURN 1';

    // When & Then
    session.run(statement)
      .then(result => {
        const sum = result.summary;
        expect(sum.server).toBeDefined();
        expect(sum.server.address).toEqual('localhost:7687');
        expect(sum.server.version).toBeDefined();
        done();
      });
  });

  it('should expose execution time information when using 3.1 and onwards', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    // Given
    const statement = 'UNWIND range(1,10000) AS n RETURN n AS number';
    // When & Then

    session.run(statement)
      .then(result => {
        const sum = result.summary;
        expect(sum.resultAvailableAfter.toInt()).not.toBeLessThan(0);
        expect(sum.resultConsumedAfter.toInt()).not.toBeLessThan(0);
        done();
      });
  });

  it('should expose empty parameter map on call with no parameters', done => {
    // Given
    const statement = 'CREATE (n:Label {prop:\'string\'}) RETURN n';
    // When & Then
    session.run(statement)
      .then(result => {
        const sum = result.summary;
        expect(sum.statement.parameters).toEqual({});
        done();
      });
  });

  it('should expose plan ', done => {
    // Given
    const statement = 'EXPLAIN CREATE (n:Label {prop:{prop}}) RETURN n';
    const params = {prop: 'string'};
    // When & Then
    session
      .run(statement, params)
      .then(result => {
        const sum = result.summary;
        expect(sum.hasPlan()).toBe(true);
        expect(sum.hasProfile()).toBe(false);
        expect(sum.plan.operatorType).toBe('ProduceResults');
        expect(sum.plan.arguments.runtime).toBe('INTERPRETED');
        expect(sum.plan.identifiers[0]).toBe('n');
        expect(sum.plan.children[0].operatorType).toBe('CreateNode');
        done();
      });
  });

  it('should expose profile ', done => {
    // Given
    const statement = 'PROFILE MATCH (n:Label {prop:{prop}}) RETURN n';
    const params = {prop: 'string'};
    // When & Then
    session
      .run(statement, params)
      .then(result => {
        const sum = result.summary;
        expect(sum.hasPlan()).toBe(true); //When there's a profile, there's a plan
        expect(sum.hasProfile()).toBe(true);
        expect(sum.profile.operatorType).toBe('ProduceResults');
        expect(sum.profile.arguments.runtime).toBe('INTERPRETED');
        expect(sum.profile.identifiers[0]).toBe('n');
        expect(sum.profile.children[0].operatorType).toBe('Filter');
        expect(sum.profile.rows).toBe(0);
        //expect(sum.profile.dbHits).toBeGreaterThan(0);
        done();
      });
  });

  it('should expose cypher notifications ', done => {
    // Given
    const statement = 'EXPLAIN MATCH (n), (m) RETURN n, m';
    // When & Then
    session
      .run(statement)
      .then(result => {
        const sum = result.summary;
        expect(sum.notifications.length).toBeGreaterThan(0);
        expect(sum.notifications[0].code).toBe("Neo.ClientNotification.Statement.CartesianProductWarning");
        expect(sum.notifications[0].title).toBe("This query builds a cartesian product between disconnected patterns.");
        expect(sum.notifications[0].position.column).toBeGreaterThan(0);
        done();
      });
  });

  it('should fail when using the session when having an open transaction', done => {

    // When
    session.beginTransaction();

    //Then
    session.run("RETURN 42")
      .catch(error => {
        expect(error.message).toBe("Statements cannot be run directly on a "
          + "session with an open transaction; either run from within the "
          + "transaction or use a different session.");
        done();
      })
  });

  it('should fail when opening multiple transactions', () => {

    // When
    session.beginTransaction();

    // Then
    expect(session.beginTransaction).toThrow();
  });

  it('should return lots of data', done => {
    session.run("UNWIND range(1,10000) AS x CREATE (:ATTRACTION {prop: 'prop'})")
      .then(() => {
        session.run("MATCH (n) RETURN n")
          .subscribe(
            {
              onNext: record => {
                const node = record.get('n');
                expect(node.labels[0]).toEqual("ATTRACTION");
                expect(node.properties.prop).toEqual("prop");
              },
              onCompleted: () => {
                session.close();
                done()
              },
              onError: error => {
                console.log(error);
              }
            }
          )

      });
  });

  it('should be able to close a long running query ', done => {
    //given a long running query
    session.run('unwind range(1,1000000) as x create (n {prop:x}) delete n').catch(error => {
      // long running query should fail
      expect(error).toBeDefined();

      // and it should be possible to start another session and run a query
      const anotherSession = driver.session();
      anotherSession.run('RETURN 1.0 as a').then(result => {
        expect(result.records.length).toBe(1);
        expect(result.records[0].get('a')).toBe(1);
        done();
      }).catch(error => {
        console.log('Query failed after a long running query was terminated', error);
      });
    });

    // wait some time than close the session with a long running query
    setTimeout(() => {
      session.close();
    }, 1000);
  });

  it('should fail nicely on unpackable values ', done => {
    // Given
    const unpackable = () => {
      throw Error();
    };

    const statement = 'RETURN {param}';
    const params = {param: unpackable};
    // When & Then
    session
      .run(statement, params)
      .catch(ignore => {
        done();
      })
  });

  it('should fail nicely for illegal statement', () => {
    expect(() => session.run()).toThrowError(TypeError);
    expect(() => session.run(null)).toThrowError(TypeError);
    expect(() => session.run({})).toThrowError(TypeError);
    expect(() => session.run(42)).toThrowError(TypeError);
    expect(() => session.run([])).toThrowError(TypeError);
    expect(() => session.run(['CREATE ()'])).toThrowError(TypeError);

    expect(() => session.run({statement: 'CREATE ()'})).toThrowError(TypeError);
    expect(() => session.run({cypher: 'CREATE ()'})).toThrowError(TypeError);
  });

  it('should fail nicely for illegal bookmark', () => {
    expect(() => session.beginTransaction({})).toThrowError(TypeError);
    expect(() => session.beginTransaction(42)).toThrowError(TypeError);
    expect(() => session.beginTransaction([])).toThrowError(TypeError);
    expect(() => session.beginTransaction(['bookmark'])).toThrowError(TypeError);
  });

  it('should allow creation of a ' + neo4j.session.READ + ' session', done => {
    const readSession = driver.session(neo4j.session.READ);
    readSession.run('RETURN 1').then(() => {
      readSession.close();
      done();
    });
  });

  it('should allow creation of a ' + neo4j.session.WRITE + ' session', done => {
    const writeSession = driver.session(neo4j.session.WRITE);
    writeSession.run('CREATE ()').then(() => {
      writeSession.close();
      done();
    });
  });

  it('should fail for illegal session mode', () => {
    expect(() => driver.session('ILLEGAL_MODE')).toThrow();
  });

  it('should release connection to the pool after run', done => {
    withQueryInTmpSession(driver, () => {
      const idleConnectionsBefore = idleConnectionCount(driver);

      session.run('RETURN 1').then(() => {
        const idleConnectionsAfter = idleConnectionCount(driver);
        expect(idleConnectionsBefore).toEqual(idleConnectionsAfter);
        done();
      });
    });
  });

  it('should release connection to the pool after run failure', done => {
    withQueryInTmpSession(driver, () => {
      const idleConnectionsBefore = idleConnectionCount(driver);

      session.run('RETURN 10 / 0').catch(() => {
        const idleConnectionsAfter = idleConnectionCount(driver);
        expect(idleConnectionsBefore).toEqual(idleConnectionsAfter);
        done();
      });
    });
  });

  it('should release connection to the pool when result is consumed', done => {
    withQueryInTmpSession(driver, () => {
      const idleConnectionsBefore = idleConnectionCount(driver);

      session.run('UNWIND range(0, 10) AS x RETURN x + 1').subscribe({
        onNext: () => {
          // one less idle connection, one connection is used for the current query
          expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore - 1);
        },
        onError: error => {
          console.log(error);
        },
        onCompleted: () => {
          expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore);
          done();
        }
      });
    });
  });

  it('should release connection to the pool when result fails', done => {
    withQueryInTmpSession(driver, () => {
      const idleConnectionsBefore = idleConnectionCount(driver);

      session.run('UNWIND range(10, 0, -1) AS x RETURN 10 / x').subscribe({
        onNext: () => {
          // one less idle connection, one connection is used for the current query
          expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore - 1);
        },
        onError: ignoredError => {
          expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore);
          done();
        },
        onCompleted: () => {
        }
      });
    });
  });

  it('should release connection to the pool when transaction commits', done => {
    withQueryInTmpSession(driver, () => {
      const idleConnectionsBefore = idleConnectionCount(driver);

      const tx = session.beginTransaction();
      tx.run('UNWIND range(0, 10) AS x RETURN x + 1').subscribe({
        onNext: () => {
          // one less idle connection, one connection is used for the current transaction
          expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore - 1);
        },
        onError: error => {
          console.log(error);
        },
        onCompleted: () => {
          // one less idle connection, one connection is used for the current transaction
          expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore - 1);
          tx.commit().then(() => {
            expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore);
            done();
          });
        }
      });
    });
  });

  it('should release connection to the pool when transaction rolls back', done => {
    withQueryInTmpSession(driver, () => {
      const idleConnectionsBefore = idleConnectionCount(driver);

      const tx = session.beginTransaction();
      tx.run('UNWIND range(0, 10) AS x RETURN x + 1').subscribe({
        onNext: () => {
          // one less idle connection, one connection is used for the current transaction
          expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore - 1);
        },
        onError: error => {
          console.log(error);
        },
        onCompleted: () => {
          // one less idle connection, one connection is used for the current transaction
          expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore - 1);
          tx.rollback().then(() => {
            expect(idleConnectionCount(driver)).toBe(idleConnectionsBefore);
            done();
          });
        }
      });
    });
  });

  it('should update last bookmark after every read tx commit', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const bookmarkBefore = session.lastBookmark();

    const tx = session.beginTransaction();
    tx.run('RETURN 42 as answer').then(result => {
      const records = result.records;
      expect(records.length).toEqual(1);
      expect(records[0].get('answer').toNumber()).toEqual(42);

      tx.commit().then(() => {
        const bookmarkAfter = session.lastBookmark();
        expect(bookmarkAfter).toBeDefined();
        expect(bookmarkAfter).not.toBeNull();
        expect(bookmarkAfter).not.toEqual(bookmarkBefore);

        done();
      });
    });
  });

  it('should update last bookmark after every write tx commit', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const bookmarkBefore = session.lastBookmark();

    const tx = session.beginTransaction();
    tx.run('CREATE ()').then(() => {
      tx.commit().then(() => {
        const bookmarkAfter = session.lastBookmark();
        expect(bookmarkAfter).toBeDefined();
        expect(bookmarkAfter).not.toBeNull();
        expect(bookmarkAfter).not.toEqual(bookmarkBefore);

        done();
      });
    });
  });

  it('should not lose last bookmark after run', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const tx = session.beginTransaction();
    tx.run('CREATE ()').then(() => {
      tx.commit().then(() => {
        const bookmarkBefore = session.lastBookmark();
        expect(bookmarkBefore).toBeDefined();
        expect(bookmarkBefore).not.toBeNull();

        session.run('CREATE ()').then(() => {
          const bookmarkAfter = session.lastBookmark();
          expect(bookmarkAfter).toEqual(bookmarkBefore);
          done();
        });
      });
    });
  });

  it('should commit read transaction', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const bookmarkBefore = session.lastBookmark();
    const resultPromise = session.readTransaction(tx => tx.run('RETURN 42 AS answer'));

    resultPromise.then(result => {
      expect(result.records.length).toEqual(1);
      expect(result.records[0].get('answer').toNumber()).toEqual(42);

      const bookmarkAfter = session.lastBookmark();
      verifyBookmark(bookmarkAfter);
      expect(bookmarkAfter).not.toEqual(bookmarkBefore);

      done();
    });
  });

  it('should commit write transaction', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const bookmarkBefore = session.lastBookmark();
    const resultPromise = session.writeTransaction(tx => tx.run('CREATE (n:Node {id: 42}) RETURN n.id AS answer'));

    resultPromise.then(result => {
      expect(result.records.length).toEqual(1);
      expect(result.records[0].get('answer').toNumber()).toEqual(42);
      expect(result.summary.counters.nodesCreated()).toEqual(1);

      const bookmarkAfter = session.lastBookmark();
      verifyBookmark(bookmarkAfter);
      expect(bookmarkAfter).not.toEqual(bookmarkBefore);

      countNodes('Node', 'id', 42).then(count => {
        expect(count).toEqual(1);
        done();
      });
    });
  });

  it('should not commit already committed read transaction', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const resultPromise = session.readTransaction(tx => {
      return new Promise((resolve, reject) => {
        tx.run('RETURN 42 AS answer').then(result => {
          tx.commit().then(() => {
            resolve({result: result, bookmark: session.lastBookmark()});
          }).catch(error => reject(error));
        }).catch(error => reject(error));
      });
    });

    resultPromise.then(outcome => {
      const bookmark = outcome.bookmark;
      const result = outcome.result;

      verifyBookmark(bookmark);
      expect(session.lastBookmark()).toEqual(bookmark); // expect bookmark to not change

      expect(result.records.length).toEqual(1);
      expect(result.records[0].get('answer').toNumber()).toEqual(42);

      done();
    });
  });

  it('should not commit already committed write transaction', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const resultPromise = session.readTransaction(tx => {
      return new Promise((resolve, reject) => {
        tx.run('CREATE (n:Node {id: 42}) RETURN n.id AS answer').then(result => {
          tx.commit().then(() => {
            resolve({result: result, bookmark: session.lastBookmark()});
          }).catch(error => reject(error));
        }).catch(error => reject(error));
      });
    });

    resultPromise.then(outcome => {
      const bookmark = outcome.bookmark;
      const result = outcome.result;

      verifyBookmark(bookmark);
      expect(session.lastBookmark()).toEqual(bookmark); // expect bookmark to not change

      expect(result.records.length).toEqual(1);
      expect(result.records[0].get('answer').toNumber()).toEqual(42);
      expect(result.summary.counters.nodesCreated()).toEqual(1);

      countNodes('Node', 'id', 42).then(count => {
        expect(count).toEqual(1);
        done();
      });
    });
  });

  it('should not commit rolled back read transaction', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const bookmarkBefore = session.lastBookmark();
    const resultPromise = session.readTransaction(tx => {
      return new Promise((resolve, reject) => {
        tx.run('RETURN 42 AS answer').then(result => {
          tx.rollback().then(() => {
            resolve(result);
          }).catch(error => reject(error));
        }).catch(error => reject(error));
      });
    });

    resultPromise.then(result => {
      expect(result.records.length).toEqual(1);
      expect(result.records[0].get('answer').toNumber()).toEqual(42);
      expect(session.lastBookmark()).toBe(bookmarkBefore); // expect bookmark to not change

      done();
    });
  });

  it('should not commit rolled back write transaction', done => {
    if (!serverIs31OrLater(done)) {
      return;
    }

    const bookmarkBefore = session.lastBookmark();
    const resultPromise = session.readTransaction(tx => {
      return new Promise((resolve, reject) => {
        tx.run('CREATE (n:Node {id: 42}) RETURN n.id AS answer').then(result => {
          tx.rollback().then(() => {
            resolve(result);
          }).catch(error => reject(error));
        }).catch(error => reject(error));
      });
    });

    resultPromise.then(result => {
      expect(result.records.length).toEqual(1);
      expect(result.records[0].get('answer').toNumber()).toEqual(42);
      expect(result.summary.counters.nodesCreated()).toEqual(1);
      expect(session.lastBookmark()).toBe(bookmarkBefore); // expect bookmark to not change

      countNodes('Node', 'id', 42).then(count => {
        expect(count).toEqual(0);
        done();
      });
    });
  });

  it('should interrupt query waiting on a lock when closed', done => {
    if (!serverIs31OrLater(done)) {
      // locks are transaction termination aware by default only in 3.1+
      return;
    }

    session.run('CREATE ()').then(() => {
      session.close(() => {
        const session1 = driver.session();
        const session2 = driver.session();
        const tx1 = session1.beginTransaction();

        tx1.run('MATCH (n) SET n.id = 1 RETURN 42 AS answer').then(result => {
          // node is now locked by tx1
          expect(result.records.length).toEqual(1);
          expect(result.records[0].get(0).toNumber()).toEqual(42);

          // this query should get stuck waiting for the lock
          session2.run('MATCH (n) SET n.id = 2 RETURN 42 AS answer').catch(error => {
            expectTransactionTerminatedError(error);
            tx1.commit().then(() => {
              readAllNodeIds().then(ids => {
                expect(ids).toEqual([1]);
                done();
              });
            });
          });

          setTimeout(() => {
            // close session after a while
            session2.close();
          }, 1000);
        });
      });
    });
  });

  it('should interrupt transaction waiting on a lock when closed', done => {
    if (!serverIs31OrLater(done)) {
      // locks are transaction termination aware by default only in 3.1+
      return;
    }

    session.run('CREATE ()').then(() => {
      session.close(() => {
        const session1 = driver.session();
        const session2 = driver.session();
        const tx1 = session1.beginTransaction();
        const tx2 = session2.beginTransaction();

        tx1.run('MATCH (n) SET n.id = 1 RETURN 42 AS answer').then(result => {
          // node is now locked by tx1
          expect(result.records.length).toEqual(1);
          expect(result.records[0].get(0).toNumber()).toEqual(42);

          // this query should get stuck waiting for the lock
          tx2.run('MATCH (n) SET n.id = 2 RETURN 42 AS answer').catch(error => {
            expectTransactionTerminatedError(error);
            tx1.commit().then(() => {
              readAllNodeIds().then(ids => {
                expect(ids).toEqual([1]);
                done();
              });
            });
          });

          setTimeout(() => {
            // close session after a while
            session2.close();
          }, 1000);
        });
      });
    });
  });

  it('should interrupt transaction function waiting on a lock when closed', done => {
    if (!serverIs31OrLater(done)) {
      // locks are transaction termination aware by default only in 3.1+
      return;
    }

    session.run('CREATE ()').then(() => {
      session.close(() => {
        const session1 = driver.session();
        const session2 = driver.session();
        const tx1 = session1.beginTransaction();

        tx1.run('MATCH (n) SET n.id = 1 RETURN 42 AS answer').then(result => {
          // node is now locked by tx1
          expect(result.records.length).toEqual(1);
          expect(result.records[0].get(0).toNumber()).toEqual(42);

          session2.writeTransaction(tx2 => {
            // this query should get stuck waiting for the lock
            return tx2.run('MATCH (n) SET n.id = 2 RETURN 42 AS answer').catch(error => {
              expectTransactionTerminatedError(error);
              tx1.commit().then(() => {
                readAllNodeIds().then(ids => {
                  expect(ids).toEqual([1]);
                  done();
                });
              });
            });
          });

          setTimeout(() => {
            // close session after a while
            session2.close();
          }, 1000);
        });
      });
    });
  });

  function serverIs31OrLater(done) {
    // lazy way of checking the version number
    // if server has been set we know it is at least 3.1
    if (!serverMetadata) {
      done();
      return false;
    }
    return true;
  }

  function countNodes(label, propertyKey, propertyValue) {
    return new Promise((resolve, reject) => {
      session.run(`MATCH (n: ${label} {${propertyKey}: ${propertyValue}}) RETURN count(n) AS count`).then(result => {
        resolve(result.records[0].get('count').toNumber());
      }).catch(error => reject(error));
    });
  }

  function withQueryInTmpSession(driver, callback) {
    const tmpSession = driver.session();
    return tmpSession.run('RETURN 1').then(() => {
      tmpSession.close(callback);
    });
  }

  function newSessionWithConnection(connection) {
    const connectionProvider = new SingleConnectionProvider(Promise.resolve(connection));
    const session = new Session(READ, connectionProvider);
    session.beginTransaction(); // force session to acquire new connection
    return session;
  }

  function idleConnectionCount(driver) {
    const connectionProvider = driver._connectionProvider;
    const address = connectionProvider._address;
    const connectionPool = connectionProvider._connectionPool;
    const idleConnections = connectionPool._pools[address];
    return idleConnections.length;
  }

  function verifyBookmark(bookmark) {
    expect(bookmark).toBeDefined();
    expect(bookmark).not.toBeNull();
  }

  function expectTransactionTerminatedError(error) {
    expect(error.message.toLowerCase().indexOf('transaction terminated') >= 0).toBeTruthy();
  }

  function readAllNodeIds() {
    return new Promise((resolve, reject) => {
      const session = driver.session();
      session.run('MATCH (n) RETURN n.id').then(result => {
        const ids = result.records.map(record => record.get(0).toNumber());
        session.close();
        resolve(ids);
      }).catch(error => {
        reject(error);
      });
    });
  }
});
