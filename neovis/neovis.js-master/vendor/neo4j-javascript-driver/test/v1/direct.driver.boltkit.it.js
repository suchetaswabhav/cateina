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

import neo4j from '../../lib/v1';
import {READ, WRITE} from '../../lib/v1/driver';
import boltkit from './boltkit';

describe('direct driver', () => {

  it('should run query', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    // Given
    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/return_x.script', 9001);

    kit.run(() => {
      const driver = createDriver();
      // When
      const session = driver.session();
      // Then
      session.run('RETURN {x}', {'x': 1}).then(res => {
          expect(res.records[0].get('x').toInt()).toEqual(1);
          session.close();
          driver.close();
        server.exit(code => {
          expect(code).toEqual(0);
          done();
        });
      });
    });
  });

  it('should send and receive bookmark for read transaction', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/read_tx_with_bookmarks.script', 9001);

    kit.run(() => {
      const driver = createDriver();
      const session = driver.session(READ, 'OldBookmark');
      const tx = session.beginTransaction();
      tx.run('MATCH (n) RETURN n.name AS name').then(result => {
        const records = result.records;
        expect(records.length).toEqual(2);
        expect(records[0].get('name')).toEqual('Bob');
        expect(records[1].get('name')).toEqual('Alice');

        tx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('NewBookmark');

          session.close(() => {
            driver.close();
            server.exit(code => {
              expect(code).toEqual(0);
              done();
            });
          });
        });
      });
    });
  });

  it('should send and receive bookmark for write transaction', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/write_tx_with_bookmarks.script', 9001);

    kit.run(() => {
      const driver = createDriver();
      const session = driver.session(WRITE, 'OldBookmark');
      const tx = session.beginTransaction();
      tx.run('CREATE (n {name:\'Bob\'})').then(result => {
        const records = result.records;
        expect(records.length).toEqual(0);

        tx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('NewBookmark');

          session.close(() => {
            driver.close();
            server.exit(code => {
              expect(code).toEqual(0);
              done();
            });
          });
        });
      });
    });
  });

  it('should send and receive bookmark between write and read transactions', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/write_read_tx_with_bookmarks.script', 9001);

    kit.run(() => {
      const driver = createDriver();
      const session = driver.session(WRITE, 'BookmarkA');
      const writeTx = session.beginTransaction();
      writeTx.run('CREATE (n {name:\'Bob\'})').then(result => {
        const records = result.records;
        expect(records.length).toEqual(0);

        writeTx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('BookmarkB');

          const readTx = session.beginTransaction();
          readTx.run('MATCH (n) RETURN n.name AS name').then(result => {
            const records = result.records;
            expect(records.length).toEqual(1);
            expect(records[0].get('name')).toEqual('Bob');

            readTx.commit().then(() => {
              expect(session.lastBookmark()).toEqual('BookmarkC');

              session.close(() => {
                driver.close();
                server.exit(code => {
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

  it('should be possible to override bookmark', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/write_read_tx_with_bookmark_override.script', 9001);

    kit.run(() => {
      const driver = createDriver();
      const session = driver.session(WRITE, 'BookmarkA');
      const writeTx = session.beginTransaction();
      writeTx.run('CREATE (n {name:\'Bob\'})').then(result => {
        const records = result.records;
        expect(records.length).toEqual(0);

        writeTx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('BookmarkB');

          const readTx = session.beginTransaction('BookmarkOverride');
          readTx.run('MATCH (n) RETURN n.name AS name').then(result => {
            const records = result.records;
            expect(records.length).toEqual(1);
            expect(records[0].get('name')).toEqual('Bob');

            readTx.commit().then(() => {
              expect(session.lastBookmark()).toEqual('BookmarkC');

              session.close(() => {
                driver.close();
                server.exit(code => {
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

  it('should not be possible to override bookmark with null', done => {
    if (!boltkit.BoltKitSupport) {
      done();
      return;
    }

    const kit = new boltkit.BoltKit();
    const server = kit.start('./test/resources/boltkit/write_read_tx_with_bookmarks.script', 9001);

    kit.run(() => {
      const driver = createDriver();
      const session = driver.session(WRITE, 'BookmarkA');
      const writeTx = session.beginTransaction();
      writeTx.run('CREATE (n {name:\'Bob\'})').then(result => {
        const records = result.records;
        expect(records.length).toEqual(0);

        writeTx.commit().then(() => {
          expect(session.lastBookmark()).toEqual('BookmarkB');

          const readTx = session.beginTransaction(null);
          readTx.run('MATCH (n) RETURN n.name AS name').then(result => {
            const records = result.records;
            expect(records.length).toEqual(1);
            expect(records[0].get('name')).toEqual('Bob');

            readTx.commit().then(() => {
              expect(session.lastBookmark()).toEqual('BookmarkC');

              session.close(() => {
                driver.close();
                server.exit(code => {
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

function createDriver() {
  // BoltKit currently does not support encryption, create driver with encryption turned off
  const config = {
    encrypted: 'ENCRYPTION_OFF'
  };
  return neo4j.driver('bolt://localhost:9001', neo4j.auth.basic('neo4j', 'neo4j'), config);
}
