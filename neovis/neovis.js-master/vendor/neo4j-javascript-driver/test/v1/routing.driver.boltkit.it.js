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
import {READ, WRITE} from '../../src/v1/driver';
import boltkit from './boltkit';
import RoutingTable from '../../src/v1/internal/routing-table';
import {SESSION_EXPIRED} from '../../src/v1/error';
import {hijackNextDateNowCall} from '../internal/timers-util';

describe('routing driver', () => {
  let originalTimeout;

  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  it('should discover server', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/discover_servers_and_read.script', 9001);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session();
      session.run("MATCH (n) RETURN n.name").then(() => {

        session.close();
        // Then
        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9001')).toBeTruthy();
        assertHasRouters(driver, ["127.0.0.1:9001", "127.0.0.1:9002", "127.0.0.1:9003"]);
        assertHasReaders(driver, ["127.0.0.1:9002", "127.0.0.1:9003"]);
        assertHasWriters(driver, ["127.0.0.1:9001"]);

        driver.close();
        server.exit(code => {
          expect(code).toEqual(0);
          done();
        });
      });
    });
  });

  it('should purge connections to stale servers after routing table refresh', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9042);
    const reader = kit.start('./test/resources/boltkit/read_server.script', 9005);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9042');
      const session = driver.session(neo4j.session.READ);
      session.run('MATCH (n) RETURN n.name').then(() => {
        session.close();

        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9042')).toBeFalsy();
        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9005')).toBeTruthy();

        driver.close();
        router.exit(routerCode => {
          reader.exit(readerCode => {
            expect(routerCode).toEqual(0);
            expect(readerCode).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should discover new servers', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/discover_new_servers.script', 9001);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session();
      session.run("MATCH (n) RETURN n.name").then(() => {

        // Then
        assertHasRouters(driver, ["127.0.0.1:9004", "127.0.0.1:9002", "127.0.0.1:9003"]);
        assertHasReaders(driver, ["127.0.0.1:9005", "127.0.0.1:9003"]);
        assertHasWriters(driver, ["127.0.0.1:9001"]);

        driver.close();
        server.exit(code => {
          expect(code).toEqual(0);
          done();
        });
      });
    });
  });

  it('should discover new servers using subscribe', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/discover_new_servers.script', 9001);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session();
      session.run("MATCH (n) RETURN n.name").subscribe({
        onCompleted: () => {

          // Then
          assertHasRouters(driver, ["127.0.0.1:9004", "127.0.0.1:9002", "127.0.0.1:9003"]);
          assertHasReaders(driver, ["127.0.0.1:9005", "127.0.0.1:9003"]);
          assertHasWriters(driver, ["127.0.0.1:9001"]);

          driver.close();
          server.exit(code => {
            expect(code).toEqual(0);
            done();
          });
        }
      });
    });
  });

  it('should handle empty response from server', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/empty_get_servers_response.script', 9001);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");

      // When
      const session = driver.session(neo4j.READ);
      session.run("MATCH (n) RETURN n.name").catch(err => {
        expect(err.code).toEqual(neo4j.error.PROTOCOL_ERROR);

        session.close();
        driver.close();
        server.exit(code => {
          expect(code).toEqual(0);
          done();
        });
      }).catch(err => {
        console.log(err)
      });
    });
  });

  it('should acquire read server', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer = kit.start('./test/resources/boltkit/read_server.script', 9005);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session(neo4j.session.READ);
      session.run("MATCH (n) RETURN n.name").then(res => {

        session.close();

        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9001')).toBeTruthy();
        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9005')).toBeTruthy();
        // Then
        expect(res.records[0].get('n.name')).toEqual('Bob');
        expect(res.records[1].get('n.name')).toEqual('Alice');
        expect(res.records[2].get('n.name')).toEqual('Tina');
        driver.close();
        seedServer.exit(code1 => {
          readServer.exit(code2 => {
            expect(code1).toEqual(0);
            expect(code2).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should pick first available route-server', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/short_ttl.script', 9999);
    const nextRouter = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9003);
    const readServer1 = kit.start('./test/resources/boltkit/read_server.script', 9004);
    const readServer2 = kit.start('./test/resources/boltkit/read_server.script', 9005);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9999");
      // When
      const session1 = driver.session(neo4j.session.READ);
      session1.run("MATCH (n) RETURN n.name").then(res => {
        // Then
        expect(res.records[0].get('n.name')).toEqual('Bob');
        expect(res.records[1].get('n.name')).toEqual('Alice');
        expect(res.records[2].get('n.name')).toEqual('Tina');
        session1.close();

        const session2 = driver.session(neo4j.session.READ);
        session2.run("MATCH (n) RETURN n.name").then(res => {
          // Then
          expect(res.records[0].get('n.name')).toEqual('Bob');
          expect(res.records[1].get('n.name')).toEqual('Alice');
          expect(res.records[2].get('n.name')).toEqual('Tina');
          session2.close();
          driver.close();
          seedServer.exit(code1 => {
            nextRouter.exit(code2 => {
              readServer1.exit(code3 => {
                readServer2.exit(code4 => {
                  expect(code1).toEqual(0);
                  expect(code2).toEqual(0);
                  expect(code3).toEqual(0);
                  expect(code4).toEqual(0);
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  it('should round-robin among read servers', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer1 = kit.start('./test/resources/boltkit/read_server.script', 9005);
    const readServer2 = kit.start('./test/resources/boltkit/read_server.script', 9006);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session1 = driver.session(neo4j.session.READ);
      session1.run("MATCH (n) RETURN n.name").then(res => {
        // Then
        expect(res.records[0].get('n.name')).toEqual('Bob');
        expect(res.records[1].get('n.name')).toEqual('Alice');
        expect(res.records[2].get('n.name')).toEqual('Tina');
        session1.close();
        const session2 = driver.session(neo4j.session.READ);
        session2.run("MATCH (n) RETURN n.name").then(res => {
          // Then
          expect(res.records[0].get('n.name')).toEqual('Bob');
          expect(res.records[1].get('n.name')).toEqual('Alice');
          expect(res.records[2].get('n.name')).toEqual('Tina');
          session2.close();

          driver.close();
          seedServer.exit(code1 => {
            readServer1.exit(code2 => {
              readServer2.exit(code3 => {
                expect(code1).toEqual(0);
                expect(code2).toEqual(0);
                expect(code3).toEqual(0);
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should handle missing read server', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer = kit.start('./test/resources/boltkit/dead_read_server.script', 9005);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session(neo4j.session.READ);
      session.run("MATCH (n) RETURN n.name").catch(err => {
        expect(err.code).toEqual(neo4j.error.SESSION_EXPIRED);
        driver.close();
        seedServer.exit(code1 => {
          readServer.exit(code2 => {
            expect(code1).toEqual(0);
            expect(code2).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should acquire write server', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const writeServer = kit.start('./test/resources/boltkit/write_server.script', 9007);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session(neo4j.session.WRITE);
      session.run("CREATE (n {name:'Bob'})").then(() => {

        // Then
        driver.close();
        seedServer.exit(code1 => {
          writeServer.exit(code2 => {
            expect(code1).toEqual(0);
            expect(code2).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should round-robin among write servers', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer1 = kit.start('./test/resources/boltkit/write_server.script', 9007);
    const readServer2 = kit.start('./test/resources/boltkit/write_server.script', 9008);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session1 = driver.session(neo4j.session.WRITE);
      session1.run("CREATE (n {name:'Bob'})").then(() => {
        const session2 = driver.session(neo4j.session.WRITE);
        session2.run("CREATE (n {name:'Bob'})").then(() => {
          // Then
          driver.close();
          seedServer.exit(code1 => {
            readServer1.exit(code2 => {
              readServer2.exit(code3 => {
                expect(code1).toEqual(0);
                expect(code2).toEqual(0);
                expect(code3).toEqual(0);
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should handle missing write server', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer = kit.start('./test/resources/boltkit/dead_read_server.script', 9007);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session(neo4j.session.WRITE);
      session.run("MATCH (n) RETURN n.name").catch(err => {
        expect(err.code).toEqual(neo4j.error.SESSION_EXPIRED);
        driver.close();
        seedServer.exit(code1 => {
          readServer.exit(code2 => {
            expect(code1).toEqual(0);
            expect(code2).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should remember endpoints', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer = kit.start('./test/resources/boltkit/read_server.script', 9005);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session(neo4j.session.READ);
      session.run("MATCH (n) RETURN n.name").then(() => {

        // Then
        assertHasRouters(driver, ['127.0.0.1:9001', '127.0.0.1:9002', '127.0.0.1:9003']);
        assertHasReaders(driver, ['127.0.0.1:9005', '127.0.0.1:9006']);
        assertHasWriters(driver, ['127.0.0.1:9007', '127.0.0.1:9008']);
        driver.close();
        seedServer.exit(code1 => {
          readServer.exit(code2 => {
            expect(code1).toEqual(0);
            expect(code2).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should forget endpoints on failure', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer = kit.start('./test/resources/boltkit/dead_read_server.script', 9005);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session(neo4j.session.READ);
      session.run("MATCH (n) RETURN n.name").catch(() => {
        session.close();
        // Then
        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9001')).toBeTruthy();
        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9005')).toBeFalsy();
        assertHasRouters(driver, ['127.0.0.1:9001', '127.0.0.1:9002', '127.0.0.1:9003']);
        assertHasReaders(driver, ['127.0.0.1:9006']);
        assertHasWriters(driver, ['127.0.0.1:9007', '127.0.0.1:9008']);
        driver.close();
        seedServer.exit(code1 => {
          readServer.exit(code2 => {
            expect(code1).toEqual(0);
            expect(code2).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should forget endpoints on session acquisition failure', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session(neo4j.session.READ);
      session.run("MATCH (n) RETURN n.name").catch(() => {
        session.close();
        // Then
        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9001')).toBeTruthy();
        expect(hasAddressInConnectionPool(driver, '127.0.0.1:9005')).toBeFalsy();
        assertHasRouters(driver, ['127.0.0.1:9001', '127.0.0.1:9002', '127.0.0.1:9003']);
        assertHasReaders(driver, ['127.0.0.1:9006']);
        assertHasWriters(driver, ['127.0.0.1:9007', '127.0.0.1:9008']);
        driver.close();
        seedServer.exit(code => {
          expect(code).toEqual(0);
          done();
        });
      });
    });
  });

  it('should rediscover if necessary', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/rediscover.script', 9001);
    const readServer = kit.start('./test/resources/boltkit/read_server.script', 9005);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session1 = driver.session(neo4j.session.READ);
      session1.run("MATCH (n) RETURN n.name").catch(() => {
        const session2 = driver.session(neo4j.session.READ);
        session2.run("MATCH (n) RETURN n.name").then(() => {
          driver.close();
          seedServer.exit(code1 => {
            readServer.exit(code2 => {
              expect(code1).toEqual(0);
              expect(code2).toEqual(0);
              done();
            });
          });
        });
      });
    });
  });

  it('should handle server not able to do routing', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    // Given
    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/non_discovery.script', 9001);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session();
      session.run("MATCH (n) RETURN n.name").catch(err => {
        expect(err.code).toEqual(neo4j.error.SERVICE_UNAVAILABLE);
        expect(err.message.indexOf('could not perform routing') > 0).toBeTruthy();
        assertHasRouters(driver, ['127.0.0.1:9001']);
        session.close();
        driver.close();
        server.exit(code => {
          expect(code).toEqual(0);
          done();
        });
      });
    });
  });

  it('should handle leader switch while writing', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer = kit.start('./test/resources/boltkit/not_able_to_write.script', 9007);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session();
      session.run("CREATE ()").catch(err => {
        //the server at 9007 should have been removed
        assertHasWriters(driver, ['127.0.0.1:9008']);
        expect(err.code).toEqual(neo4j.error.SESSION_EXPIRED);
        session.close();
        driver.close();
        seedServer.exit(code1 => {
          readServer.exit(code2 => {
            expect(code1).toEqual(0);
            expect(code2).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should handle leader switch while writing on transaction', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const readServer = kit.start('./test/resources/boltkit/not_able_to_write_in_transaction.script', 9007);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session();
      const tx = session.beginTransaction();
      tx.run("CREATE ()");

      tx.commit().catch(err => {
        //the server at 9007 should have been removed
        assertHasWriters(driver, ['127.0.0.1:9008']);
        expect(err.code).toEqual(neo4j.error.SESSION_EXPIRED);
        session.close();
        driver.close();
        seedServer.exit(code1 => {
          readServer.exit(code2 => {
            expect(code1).toEqual(0);
            expect(code2).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should fail if missing write server', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/no_writers.script', 9001);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const session = driver.session(neo4j.session.WRITE);
      session.run("MATCH (n) RETURN n.name").catch(err => {
        expect(err.code).toEqual(neo4j.error.SERVICE_UNAVAILABLE);
        driver.close();
        seedServer.exit(code => {
          expect(code).toEqual(0);
          done();
        });
      });
    });
  });

  it('should try next router when no writers', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const server1 = kit.start('./test/resources/boltkit/routing_table_with_zero_ttl.script', 9999);
    const server2 = kit.start('./test/resources/boltkit/no_writers.script', 9091);
    const server3 = kit.start('./test/resources/boltkit/no_writers.script', 9092);
    const server4 = kit.start('./test/resources/boltkit/no_writers.script', 9093);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9999');

      const session1 = driver.session();
      session1.run('MATCH (n) RETURN n').then(result1 => {
        expect(result1.summary.server.address).toEqual('127.0.0.1:9999');
        session1.close();

        assertHasRouters(driver, ['127.0.0.1:9091', '127.0.0.1:9092', '127.0.0.1:9093', '127.0.0.1:9999']);
        const memorizingRoutingTable = setUpMemorizingRoutingTable(driver);

        const session2 = driver.session();
        session2.run('MATCH (n) RETURN n').then(result2 => {
          expect(result2.summary.server.address).toEqual('127.0.0.1:9999');
          session2.close();

          memorizingRoutingTable.assertForgotRouters([]);
          assertHasRouters(driver, ['127.0.0.1:9999']);
          driver.close();

          server1.exit(code1 => {
            server2.exit(code2 => {
              server3.exit(code3 => {
                server4.exit(code4 => {
                  expect(code1).toEqual(0);
                  expect(code2).toEqual(0);
                  expect(code3).toEqual(0);
                  expect(code4).toEqual(0);
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  it('should re-use connections', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }
    // Given
    const kit = new boltkit.BoltKit();
    const seedServer = kit.start('./test/resources/boltkit/single_write_server.script', 9002);
    const writeServer = kit.start('./test/resources/boltkit/two_write_responses_server.script', 9001);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9002");
      // When
      const session1 = driver.session(neo4j.session.WRITE);
      session1.run("CREATE (n {name:'Bob'})").then(() => {
        session1.close(() => {
          const connections = Object.keys(driver._openSessions).length;
          const session2 = driver.session(neo4j.session.WRITE);
          session2.run("CREATE ()").then(() => {
            driver.close();
            seedServer.exit(code1 => {
              writeServer.exit(code2 => {
                expect(connections).toEqual(Object.keys(driver._openSessions).length);
                expect(code1).toEqual(0);
                expect(code2).toEqual(0);
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should expose server info in cluster', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    // Given
    const kit = new boltkit.BoltKit();
    const routingServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const writeServer = kit.start('./test/resources/boltkit/write_server_with_version.script', 9007);
    const readServer = kit.start('./test/resources/boltkit/read_server_with_version.script', 9005);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const readSession = driver.session(neo4j.session.READ);
      readSession.run('MATCH (n) RETURN n.name').then(readResult => {
        const writeSession = driver.session(neo4j.session.WRITE);
        writeSession.run("CREATE (n {name:'Bob'})").then(writeResult => {
          const readServerInfo = readResult.summary.server;
          const writeServerInfo = writeResult.summary.server;

          readSession.close();
          writeSession.close();
          driver.close();

          routingServer.exit(routingServerExitCode => {
            writeServer.exit(writeServerExitCode => {
              readServer.exit(readServerExitCode => {

                expect(readServerInfo.address).toBe('127.0.0.1:9005');
                expect(readServerInfo.version).toBe('TheReadServerV1');

                expect(writeServerInfo.address).toBe('127.0.0.1:9007');
                expect(writeServerInfo.version).toBe('TheWriteServerV1');

                expect(routingServerExitCode).toEqual(0);
                expect(writeServerExitCode).toEqual(0);
                expect(readServerExitCode).toEqual(0);

                done();
              });
            });
          });
        })
      });
    });
  });

  it('should expose server info in cluster using observer', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    // Given
    const kit = new boltkit.BoltKit();
    const routingServer = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const writeServer = kit.start('./test/resources/boltkit/write_server_with_version.script', 9007);
    const readServer = kit.start('./test/resources/boltkit/read_server_with_version.script', 9005);

    kit.run(() => {
      const driver = newDriver("bolt+routing://127.0.0.1:9001");
      // When
      const readSession = driver.session(neo4j.session.READ);
      readSession.run('MATCH (n) RETURN n.name').subscribe({
        onNext: () => {
        },
        onError: () => {
        },
        onCompleted: readSummary => {
          const writeSession = driver.session(neo4j.session.WRITE);
          writeSession.run("CREATE (n {name:'Bob'})").subscribe({
            onNext: () => {
            },
            onError: () => {
            },
            onCompleted: writeSummary => {
              readSession.close();
              writeSession.close();
              driver.close();

              routingServer.exit(routingServerExitCode => {
                writeServer.exit(writeServerExitCode => {
                  readServer.exit(readServerExitCode => {

                    expect(readSummary.server.address).toBe('127.0.0.1:9005');
                    expect(readSummary.server.version).toBe('TheReadServerV1');

                    expect(writeSummary.server.address).toBe('127.0.0.1:9007');
                    expect(writeSummary.server.version).toBe('TheWriteServerV1');

                    expect(routingServerExitCode).toEqual(0);
                    expect(writeServerExitCode).toEqual(0);
                    expect(readServerExitCode).toEqual(0);

                    done();
                  });
                });
              });
            }
          })
        }
      });
    });
  });

  it('should forget routers when fails to connect', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/routing_table_with_zero_ttl.script', 9999);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9999');

      const session1 = driver.session();
      session1.run('MATCH (n) RETURN n').then(result1 => {
        expect(result1.summary.server.address).toEqual('127.0.0.1:9999');
        session1.close();

        assertHasRouters(driver, ['127.0.0.1:9091', '127.0.0.1:9092', '127.0.0.1:9093', '127.0.0.1:9999']);
        const memorizingRoutingTable = setUpMemorizingRoutingTable(driver);

        const session2 = driver.session();
        session2.run('MATCH (n) RETURN n').then(result2 => {
          expect(result2.summary.server.address).toEqual('127.0.0.1:9999');
          session2.close();

          memorizingRoutingTable.assertForgotRouters(['127.0.0.1:9091', '127.0.0.1:9092', '127.0.0.1:9093']);
          assertHasRouters(driver, ['127.0.0.1:9999']);
          driver.close();

          server.exit(code1 => {
            expect(code1).toEqual(0);
            done();
          });
        });
      });
    });
  });

  it('should close connection used for routing table refreshing', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    // server is both router and writer
    const server = kit.start('./test/resources/boltkit/discover_new_servers.script', 9001);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');

      const acquiredConnections = [];
      const releasedConnections = [];
      setUpPoolToMemorizeAllAcquiredAndReleasedConnections(driver, acquiredConnections, releasedConnections);

      const session = driver.session();
      session.run('MATCH (n) RETURN n.name').then(() => {
        session.close(() => {
          driver.close();
          server.exit(code => {
            expect(code).toEqual(0);

            // two connections should have been acquired: one for rediscovery and one for the query
            expect(acquiredConnections.length).toEqual(2);
            // same two connections should have been released
            expect(releasedConnections.length).toEqual(2);

            // verify that acquired connections are those that we released
            for (let i = 0; i < acquiredConnections.length; i++) {
              expect(acquiredConnections[i]).toBe(releasedConnections[i]);
            }
            done();
          });
        });
      }).catch(console.log);
    });
  });

  it('should throw protocol error when no records', done => {
    testForProtocolError('./test/resources/boltkit/empty_get_servers_response.script', done);
  });

  it('should throw protocol error when no TTL entry', done => {
    testForProtocolError('./test/resources/boltkit/no_ttl_entry_get_servers.script', done);
  });

  it('should throw protocol error when no servers entry', done => {
    testForProtocolError('./test/resources/boltkit/no_servers_entry_get_servers.script', done);
  });

  it('should throw protocol error when multiple records', done => {
    testForProtocolError('./test/resources/boltkit/unparseable_ttl_get_servers.script', done);
  });

  it('should throw protocol error on unparsable record', done => {
    testForProtocolError('./test/resources/boltkit/unparseable_servers_get_servers.script', done);
  });

  it('should throw protocol error when no routers', done => {
    testForProtocolError('./test/resources/boltkit/no_routers_get_servers.script', done);
  });

  it('should throw protocol error when no readers', done => {
    testForProtocolError('./test/resources/boltkit/no_readers_get_servers.script', done);
  });

  it('should accept routing table with 1 router, 1 reader and 1 writer', done => {
    testRoutingTableAcceptance(
      {
        routers: ['127.0.0.1:9091'],
        readers: ['127.0.0.1:9092'],
        writers: ['127.0.0.1:9999']
      },
      9999, done);
  });

  it('should accept routing table with 2 routers, 1 reader and 1 writer', done => {
    testRoutingTableAcceptance(
      {
        routers: ['127.0.0.1:9091', '127.0.0.1:9092'],
        readers: ['127.0.0.1:9092'],
        writers: ['127.0.0.1:9999']
      },
      9999, done);
  });

  it('should accept routing table with 1 router, 2 readers and 1 writer', done => {
    testRoutingTableAcceptance(
      {
        routers: ['127.0.0.1:9091'],
        readers: ['127.0.0.1:9092', '127.0.0.1:9093'],
        writers: ['127.0.0.1:9999']
      },
      9999, done);
  });

  it('should accept routing table with 2 routers, 2 readers and 1 writer', done => {
    testRoutingTableAcceptance(
      {
        routers: ['127.0.0.1:9091', '127.0.0.1:9092'],
        readers: ['127.0.0.1:9093', '127.0.0.1:9094'],
        writers: ['127.0.0.1:9999']
      },
      9999, done);
  });

  it('should accept routing table with 1 router, 1 reader and 2 writers', done => {
    testRoutingTableAcceptance(
      {
        routers: ['127.0.0.1:9091'],
        readers: ['127.0.0.1:9092'],
        writers: ['127.0.0.1:9999', '127.0.0.1:9093']
      },
      9999, done);
  });

  it('should accept routing table with 2 routers, 1 reader and 2 writers', done => {
    testRoutingTableAcceptance(
      {
        routers: ['127.0.0.1:9091', '127.0.0.1:9092'],
        readers: ['127.0.0.1:9093'],
        writers: ['127.0.0.1:9999', '127.0.0.1:9094']
      },
      9999, done);
  });

  it('should accept routing table with 1 router, 2 readers and 2 writers', done => {
    testRoutingTableAcceptance(
      {
        routers: ['127.0.0.1:9091'],
        readers: ['127.0.0.1:9092', '127.0.0.1:9093'],
        writers: ['127.0.0.1:9999', '127.0.0.1:9094']
      },
      9999, done);
  });

  it('should accept routing table with 2 routers, 2 readers and 2 writers', done => {
    testRoutingTableAcceptance(
      {
        routers: ['127.0.0.1:9091', '127.0.0.1:9092'],
        readers: ['127.0.0.1:9093', '127.0.0.1:9094'],
        writers: ['127.0.0.1:9999', '127.0.0.1:9095']
      },
      9999, done);
  });

  it('should send and receive bookmark', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const writer = kit.start('./test/resources/boltkit/write_tx_with_bookmarks.script', 9007);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');

      const session = driver.session();
      const tx = session.beginTransaction('OldBookmark');
      tx.run('CREATE (n {name:\'Bob\'})').then(() => {
        tx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('NewBookmark');

          session.close();
          driver.close();

          router.exit(code1 => {
            writer.exit(code2 => {
              expect(code1).toEqual(0);
              expect(code2).toEqual(0);
              done();
            });
          });
        });
      });
    });
  });

  it('should send initial bookmark wihtout access mode', done => {
    testWriteSessionWithAccessModeAndBookmark(null, 'OldBookmark', done);
  });

  it('should use write session mode and initial bookmark', done => {
    testWriteSessionWithAccessModeAndBookmark(WRITE, 'OldBookmark', done);
  });

  it('should use read session mode and initial bookmark', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const writer = kit.start('./test/resources/boltkit/read_tx_with_bookmarks.script', 9005);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');

      const session = driver.session(READ, 'OldBookmark');
      const tx = session.beginTransaction();
      tx.run('MATCH (n) RETURN n.name AS name').then(result => {
        const records = result.records;
        expect(records.length).toEqual(2);
        expect(records[0].get('name')).toEqual('Bob');
        expect(records[1].get('name')).toEqual('Alice');

        tx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('NewBookmark');

          session.close();
          driver.close();

          router.exit(code1 => {
            writer.exit(code2 => {
              expect(code1).toEqual(0);
              expect(code2).toEqual(0);
              done();
            });
          });
        });
      });
    });
  });

  it('should pass bookmark from transaction to transaction', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints_with_one_of_each.script', 9001);
    const writer = kit.start('./test/resources/boltkit/write_read_tx_with_bookmarks.script', 9007);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');

      const session = driver.session(null, 'BookmarkA');
      const writeTx = session.beginTransaction();
      writeTx.run('CREATE (n {name:\'Bob\'})').then(() => {
        writeTx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('BookmarkB');

          const readTx = session.beginTransaction();
          readTx.run('MATCH (n) RETURN n.name AS name').then(result => {
            const records = result.records;
            expect(records.length).toEqual(1);
            expect(records[0].get('name')).toEqual('Bob');

            readTx.commit().then(() => {
              expect(session.lastBookmark()).toEqual('BookmarkC');

              session.close();
              driver.close();

              router.exit(code1 => {
                writer.exit(code2 => {
                  expect(code1).toEqual(0);
                  expect(code2).toEqual(0);
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  it('should retry read transaction until success', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const brokenReader = kit.start('./test/resources/boltkit/dead_read_server.script', 9005);
    const reader = kit.start('./test/resources/boltkit/read_server.script', 9006);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');
      const session = driver.session();

      let invocations = 0;
      const resultPromise = session.readTransaction(tx => {
        invocations++;
        return tx.run('MATCH (n) RETURN n.name');
      });

      resultPromise.then(result => {
        expect(result.records.length).toEqual(3);
        expect(invocations).toEqual(2);

        session.close(() => {
          driver.close();
          router.exit(code1 => {
            brokenReader.exit(code2 => {
              reader.exit(code3 => {
                expect(code1).toEqual(0);
                expect(code2).toEqual(0);
                expect(code3).toEqual(0);
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should retry write transaction until success', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const brokenWriter = kit.start('./test/resources/boltkit/dead_write_server.script', 9007);
    const writer = kit.start('./test/resources/boltkit/write_server.script', 9008);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');
      const session = driver.session();

      let invocations = 0;
      const resultPromise = session.writeTransaction(tx => {
        invocations++;
        return tx.run('CREATE (n {name:\'Bob\'})');
      });

      resultPromise.then(result => {
        expect(result.records.length).toEqual(0);
        expect(invocations).toEqual(2);

        session.close(() => {
          driver.close();
          router.exit(code1 => {
            brokenWriter.exit(code2 => {
              writer.exit(code3 => {
                expect(code1).toEqual(0);
                expect(code2).toEqual(0);
                expect(code3).toEqual(0);
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should retry read transaction until failure', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const brokenReader1 = kit.start('./test/resources/boltkit/dead_read_server.script', 9005);
    const brokenReader2 = kit.start('./test/resources/boltkit/dead_read_server.script', 9006);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');
      const session = driver.session();

      let invocations = 0;
      const resultPromise = session.readTransaction(tx => {
        invocations++;
        if (invocations === 2) {
          // make retries stop after two invocations
          moveNextDateNow30SecondsForward();
        }
        return tx.run('MATCH (n) RETURN n.name');
      });

      resultPromise.catch(error => {
        expect(error.code).toEqual(SESSION_EXPIRED);
        expect(invocations).toEqual(2);

        session.close(() => {
          driver.close();
          router.exit(code1 => {
            brokenReader1.exit(code2 => {
              brokenReader2.exit(code3 => {
                expect(code1).toEqual(0);
                expect(code2).toEqual(0);
                expect(code3).toEqual(0);
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should retry write transaction until failure', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const brokenWriter1 = kit.start('./test/resources/boltkit/dead_write_server.script', 9007);
    const brokenWriter2 = kit.start('./test/resources/boltkit/dead_write_server.script', 9008);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');
      const session = driver.session();

      let invocations = 0;
      const resultPromise = session.writeTransaction(tx => {
        invocations++;
        if (invocations === 2) {
          // make retries stop after two invocations
          moveNextDateNow30SecondsForward();
        }
        return tx.run('CREATE (n {name:\'Bob\'})');
      });

      resultPromise.catch(error => {
        expect(error.code).toEqual(SESSION_EXPIRED);
        expect(invocations).toEqual(2);

        session.close(() => {
          driver.close();
          router.exit(code1 => {
            brokenWriter1.exit(code2 => {
              brokenWriter2.exit(code3 => {
                expect(code1).toEqual(0);
                expect(code2).toEqual(0);
                expect(code3).toEqual(0);
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should retry read transaction and perform rediscovery until success', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router1 = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9010);
    const brokenReader1 = kit.start('./test/resources/boltkit/dead_read_server.script', 9005);
    const brokenReader2 = kit.start('./test/resources/boltkit/dead_read_server.script', 9006);
    const router2 = kit.start('./test/resources/boltkit/discover_servers.script', 9001);
    const reader = kit.start('./test/resources/boltkit/read_server.script', 9002);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9010');
      const session = driver.session();

      let invocations = 0;
      const resultPromise = session.readTransaction(tx => {
        invocations++;
        return tx.run('MATCH (n) RETURN n.name');
      });

      resultPromise.then(result => {
        expect(result.records.length).toEqual(3);
        expect(invocations).toEqual(3);

        session.close(() => {
          driver.close();
          router1.exit(code1 => {
            brokenReader1.exit(code2 => {
              brokenReader2.exit(code3 => {
                router2.exit(code4 => {
                  reader.exit(code5 => {
                    expect(code1).toEqual(0);
                    expect(code2).toEqual(0);
                    expect(code3).toEqual(0);
                    expect(code4).toEqual(0);
                    expect(code5).toEqual(0);
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  it('should retry write transaction and perform rediscovery until success', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router1 = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9010);
    const brokenWriter1 = kit.start('./test/resources/boltkit/dead_write_server.script', 9007);
    const brokenWriter2 = kit.start('./test/resources/boltkit/dead_write_server.script', 9008);
    const router2 = kit.start('./test/resources/boltkit/discover_servers.script', 9002);
    const writer = kit.start('./test/resources/boltkit/write_server.script', 9009);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9010');
      const session = driver.session();

      let invocations = 0;
      const resultPromise = session.writeTransaction(tx => {
        invocations++;
        return tx.run('CREATE (n {name:\'Bob\'})');
      });

      resultPromise.then(result => {
        expect(result.records.length).toEqual(0);
        expect(invocations).toEqual(3);

        session.close(() => {
          driver.close();
          router1.exit(code1 => {
            brokenWriter1.exit(code2 => {
              brokenWriter2.exit(code3 => {
                router2.exit(code4 => {
                  writer.exit(code5 => {
                    expect(code1).toEqual(0);
                    expect(code2).toEqual(0);
                    expect(code3).toEqual(0);
                    expect(code4).toEqual(0);
                    expect(code5).toEqual(0);
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  it('should use seed router for rediscovery when all other routers are dead', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    // use scripts that exit eagerly when they are executed to simulate failed servers
    const router1 = kit.start('./test/resources/boltkit/acquire_endpoints_and_exit.script', 9010);
    const tmpReader = kit.start('./test/resources/boltkit/read_server_and_exit.script', 9005);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9010');

      // run a dummy query to force routing table initialization
      const session = driver.session(READ);
      session.run('MATCH (n) RETURN n.name').then(result => {
        expect(result.records.length).toEqual(3);
        session.close(() => {
          // stop existing router and reader
          router1.exit(code1 => {
            tmpReader.exit(code2 => {
              // at this point previously used router and reader should be dead
              expect(code1).toEqual(0);
              expect(code2).toEqual(0);

              // start new router on the same port with different script that contains itself as reader
              const router2 = kit.start('./test/resources/boltkit/rediscover_using_initial_router.script', 9010);

              kit.run(() => {
                session.readTransaction(tx => tx.run('MATCH (n) RETURN n.name AS name')).then(result => {
                  const records = result.records;
                  expect(records.length).toEqual(2);
                  expect(records[0].get('name')).toEqual('Bob');
                  expect(records[1].get('name')).toEqual('Alice');

                  session.close(() => {
                    driver.close();
                    router2.exit(code => {
                      expect(code).toEqual(0);
                      done();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  it('should use resolved seed router addresses for rediscovery when all other routers are dead', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router1 = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9010);
    // start new router on a different port to emulate host name resolution
    // this router uses different script that contains itself as reader
    const router2 = kit.start('./test/resources/boltkit/rediscover_using_initial_router.script', 9009);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9010');
      // make seed address resolve to 3 different addresses (only last one has backing stub server):
      setupFakeHostNameResolution(driver, '127.0.0.1:9010', ['127.0.0.1:9011', '127.0.0.1:9012', '127.0.0.1:9009']);
      const session = driver.session();

      session.readTransaction(tx => tx.run('MATCH (n) RETURN n.name AS name')).then(result => {
        const records = result.records;
        expect(records.length).toEqual(2);
        expect(records[0].get('name')).toEqual('Bob');
        expect(records[1].get('name')).toEqual('Alice');

        session.close(() => {
          driver.close();
          router1.exit(code1 => {
            router2.exit(code2 => {
              expect(code1).toEqual(0);
              expect(code2).toEqual(0);
              done();
            });
          });
        });
      });
    });
  });

  function moveNextDateNow30SecondsForward() {
    const currentTime = Date.now();
    hijackNextDateNowCall(currentTime + 30 * 1000 + 1);
  }

  function testWriteSessionWithAccessModeAndBookmark(accessMode, bookmark, done) {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const router = kit.start('./test/resources/boltkit/acquire_endpoints.script', 9001);
    const writer = kit.start('./test/resources/boltkit/write_tx_with_bookmarks.script', 9007);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');

      const session = driver.session(accessMode, bookmark);
      const tx = session.beginTransaction();
      tx.run('CREATE (n {name:\'Bob\'})').then(() => {
        tx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('NewBookmark');

          session.close();
          driver.close();

          router.exit(code1 => {
            writer.exit(code2 => {
              expect(code1).toEqual(0);
              expect(code2).toEqual(0);
              done();
            });
          });
        });
      });
    });
  }

  function testForProtocolError(scriptFile, done) {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const server = kit.start(scriptFile, 9001);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:9001');

      const session = driver.session();
      session.run('MATCH (n) RETURN n.name').catch(error => {
        expect(error.code).toEqual(neo4j.error.PROTOCOL_ERROR);

        session.close();
        driver.close();

        server.exit(code => {
          expect(code).toEqual(0);
          done();
        })
      });
    });
  }

  function testRoutingTableAcceptance(clusterMembers, port, done) {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const {routers, readers, writers} = clusterMembers;
    const params = {
      routers: joinStrings(routers),
      readers: joinStrings(readers),
      writers: joinStrings(writers)
    };
    const kit = new boltkit.BoltKit();
    const server = kit.startWithTemplate('./test/resources/boltkit/one_of_each_template.script.mst', params, port);

    kit.run(() => {
      const driver = newDriver('bolt+routing://127.0.0.1:' + port);

      const session = driver.session();
      session.run('MATCH (n) RETURN n.name').then(result => {

        expect(result.summary.server.address).toEqual('127.0.0.1:' + port);

        session.close();
        driver.close();

        server.exit(code => {
          expect(code).toEqual(0);
          done();
        })
      });
    });
  }

  function setUpPoolToMemorizeAllAcquiredAndReleasedConnections(driver, acquiredConnections, releasedConnections) {
    // make connection pool remember all acquired connections
    const connectionPool = getConnectionPool(driver);

    const originalAcquire = connectionPool.acquire.bind(connectionPool);
    const memorizingAcquire = (...args) => {
      const connection = originalAcquire(...args);
      acquiredConnections.push(connection);
      return connection;
    };
    connectionPool.acquire = memorizingAcquire;

    // make connection pool remember all released connections
    const originalRelease = connectionPool._release;
    const rememberingRelease = (key, resource) => {
      originalRelease(key, resource);
      releasedConnections.push(resource);
    };
    connectionPool._release = rememberingRelease;
  }

  function newDriver(url) {
    // BoltKit currently does not support encryption, create driver with encryption turned off
    return neo4j.driver(url, neo4j.auth.basic("neo4j", "neo4j"), {
      encrypted: "ENCRYPTION_OFF"
    });
  }

  function hasAddressInConnectionPool(driver, address) {
    return getConnectionPool(driver).has(address);
  }

  function assertHasRouters(driver, expectedRouters) {
    expect(getRoutingTable(driver).routers.toArray()).toEqual(expectedRouters);
  }

  function assertHasReaders(driver, expectedReaders) {
    expect(getRoutingTable(driver).readers.toArray()).toEqual(expectedReaders);
  }

  function assertHasWriters(driver, expectedWriters) {
    expect(getRoutingTable(driver).writers.toArray()).toEqual(expectedWriters);
  }

  function setUpMemorizingRoutingTable(driver) {
    const memorizingRoutingTable = new MemorizingRoutingTable(getRoutingTable(driver));
    setRoutingTable(driver, memorizingRoutingTable);
    return memorizingRoutingTable;
  }

  function setupFakeHostNameResolution(driver, seedRouter, resolvedAddresses) {
    driver._connectionProvider._hostNameResolver = new FakeHostNameResolver(seedRouter, resolvedAddresses);
  }

  function getConnectionPool(driver) {
    return driver._connectionProvider._connectionPool;
  }

  function getRoutingTable(driver) {
    return driver._connectionProvider._routingTable;
  }

  function setRoutingTable(driver, newRoutingTable) {
    driver._connectionProvider._routingTable = newRoutingTable;
  }

  function joinStrings(array) {
    return '[' + array.map(s => '"' + s + '"').join(',') + ']';
  }

  class MemorizingRoutingTable extends RoutingTable {

    constructor(initialTable) {
      super(initialTable.routers, initialTable.readers, initialTable.writers, initialTable.expirationTime);
      this._forgottenRouters = [];
    }

    forgetRouter(address) {
      super.forgetRouter(address);
      this._forgottenRouters.push(address);
    }

    assertForgotRouters(expectedRouters) {
      expect(this._forgottenRouters).toEqual(expectedRouters);
    }
  }

  class FakeHostNameResolver {

    constructor(seedRouter, resolvedAddresses) {
      this._seedRouter = seedRouter;
      this._resolvedAddresses = resolvedAddresses;
    }

    resolve(seedRouter) {
      if (seedRouter === this._seedRouter) {
        return Promise.resolve(this._resolvedAddresses);
      }
      return Promise.reject(new Error('Unexpected seed router address ' + seedRouter));
    }
  }

});
