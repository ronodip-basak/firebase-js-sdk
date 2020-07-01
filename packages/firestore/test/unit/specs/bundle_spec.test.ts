/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Query } from '../../../src/core/query';
import { doc, path, TestSnapshotVersion, version } from '../../util/helpers';

import { describeSpec, specTest } from './describe_spec';
import { client, spec } from './spec_builder';
import { TestBundleBuilder } from '../util/bundle_data';
import {
  JSON_SERIALIZER,
  TEST_DATABASE_ID
} from '../local/persistence_test_helpers';
import { DocumentKey } from '../../../src/model/document_key';
import * as api from '../../../src/protos/firestore_proto_api';
import { Value } from '../../../src/protos/firestore_proto_api';
import { toVersion } from '../../../src/remote/serializer';

interface TestBundleDocument {
  key: DocumentKey;
  readTime: TestSnapshotVersion;
  createTime?: TestSnapshotVersion;
  updateTime?: TestSnapshotVersion;
  content?: api.ApiClientObjectMap<Value>;
}
function bundleWithDocument(testDoc: TestBundleDocument): string {
  const builder = new TestBundleBuilder(TEST_DATABASE_ID);
  builder.addDocumentMetadata(
    testDoc.key,
    toVersion(JSON_SERIALIZER, version(testDoc.readTime)),
    !!testDoc.createTime
  );
  if (testDoc.createTime) {
    builder.addDocument(
      testDoc.key,
      toVersion(JSON_SERIALIZER, version(testDoc.createTime)),
      toVersion(JSON_SERIALIZER, version(testDoc.updateTime!)),
      testDoc.content!
    );
  }
  return builder.build(
    'test-bundle',
    toVersion(JSON_SERIALIZER, version(testDoc.readTime))
  );
}

describeSpec('Bundles:', ['no-ios', 'no-android'], () => {
  specTest('Newer docs from bundles should overwrite cache', [], () => {
    const query1 = Query.atPath(path('collection'));
    const docA = doc('collection/a', 1000, { key: 'a' });
    const docAChanged = doc('collection/a', 2999, { key: 'b' });

    const bundleString = bundleWithDocument({
      key: docA.key,
      readTime: 3000,
      createTime: 1999,
      updateTime: 2999,
      content: { key: { stringValue: 'b' } }
    });

    return spec()
      .userListens(query1)
      .watchAcksFull(query1, 1000, docA)
      .expectEvents(query1, { added: [docA] })
      .loadBundle(bundleString)
      .expectEvents(query1, { modified: [docAChanged], fromCache: true });
  });

  specTest('Newer deleted docs from bundles should delete cache', [], () => {
    const query1 = Query.atPath(path('collection'));
    const docA = doc('collection/a', 1000, { key: 'a' });

    const bundleString = bundleWithDocument({
      key: docA.key,
      readTime: 3000
    });

    return spec()
      .userListens(query1)
      .watchAcksFull(query1, 1000, docA)
      .expectEvents(query1, { added: [docA] })
      .loadBundle(bundleString)
      .expectEvents(query1, { removed: [docA], fromCache: true });
  });

  specTest('Older deleted docs from bundles should do nothing', [], () => {
    const query1 = Query.atPath(path('collection'));
    const docA = doc('collection/a', 1000, { key: 'a' });

    const bundleString = bundleWithDocument({
      key: docA.key,
      readTime: 999
    });

    return (
      spec()
        .userListens(query1)
        .watchAcksFull(query1, 1000, docA)
        .expectEvents(query1, { added: [docA] })
        // No events are expected here.
        .loadBundle(bundleString)
    );
  });

  specTest(
    'Newer docs from bundles should raise snapshot only when watch catches up with acknowledged writes',
    [],
    () => {
      const query = Query.atPath(path('collection'));
      const docA = doc('collection/a', 250, { key: 'a' });

      const bundleBeforeMutationAck = bundleWithDocument({
        key: docA.key,
        readTime: 500,
        createTime: 250,
        updateTime: 500,
        content: { key: { stringValue: 'b' } }
      });

      const bundleAfterMutationAck = bundleWithDocument({
        key: docA.key,
        readTime: 1001,
        createTime: 250,
        updateTime: 1001,
        content: { key: { stringValue: 'fromBundle' } }
      });
      return (
        spec()
          .withGCEnabled(false)
          .userListens(query)
          .watchAcksFull(query, 250, docA)
          .expectEvents(query, {
            added: [doc('collection/a', 250, { key: 'a' })]
          })
          .userPatches('collection/a', { key: 'patched' })
          .expectEvents(query, {
            modified: [
              doc(
                'collection/a',
                250,
                { key: 'patched' },
                { hasLocalMutations: true }
              )
            ],
            hasPendingWrites: true
          })
          .writeAcks('collection/a', 1000)
          // loading bundleBeforeMutationAck will not raise snapshots, because it is before
          // the acknowledged mutation.
          .loadBundle(bundleBeforeMutationAck)
          // loading bundleAfterMutationAck will raise a snapshot, because it is after
          // the acknowledged mutation.
          .loadBundle(bundleAfterMutationAck)
          .expectEvents(query, {
            modified: [doc('collection/a', 1001, { key: 'fromBundle' })],
            fromCache: true
          })
      );
    }
  );

  specTest(
    'Newer docs from bundles should keep not raise snapshot if there are unacknowledged writes',
    [],
    () => {
      const query = Query.atPath(path('collection'));
      const docA = doc('collection/a', 250, { key: 'a' });

      const bundleString = bundleWithDocument({
        key: docA.key,
        readTime: 1001,
        createTime: 250,
        updateTime: 1001,
        content: { key: { stringValue: 'fromBundle' } }
      });

      return (
        spec()
          .withGCEnabled(false)
          .userListens(query)
          .watchAcksFull(query, 250, docA)
          .expectEvents(query, {
            added: [doc('collection/a', 250, { key: 'a' })]
          })
          .userPatches('collection/a', { key: 'patched' })
          .expectEvents(query, {
            modified: [
              doc(
                'collection/a',
                250,
                { key: 'patched' },
                { hasLocalMutations: true }
              )
            ],
            hasPendingWrites: true
          })
          // Loading the bundle will not raise snapshots, because the
          // mutation is not acknowledged.
          .loadBundle(bundleString)
      );
    }
  );

  specTest('Newer docs from bundles might lead to limbo doc', [], () => {
    const query = Query.atPath(path('collection'));
    const docA = doc('collection/a', 1000, { key: 'a' });
    const bundleString1 = bundleWithDocument({
      key: docA.key,
      readTime: 500,
      createTime: 250,
      updateTime: 500,
      content: { key: { stringValue: 'b' } }
    });

    return (
      spec()
        .withGCEnabled(false)
        .userListens(query)
        .watchAcksFull(query, 250)
        // Backend tells there is no such doc.
        .expectEvents(query, {})
        // Bundle tells otherwise, leads to limbo.
        .loadBundle(bundleString1)
        .expectEvents(query, {
          added: [doc('collection/a', 500, { key: 'b' })],
          fromCache: true
        })
        .expectLimboDocs(docA.key)
    );
  });

  specTest(
    'Load from secondary clients and observe from primary',
    ['multi-client'],
    () => {
      const query = Query.atPath(path('collection'));
      const docA = doc('collection/a', 250, { key: 'a' });
      const bundleString1 = bundleWithDocument({
        key: docA.key,
        readTime: 500,
        createTime: 250,
        updateTime: 500,
        content: { key: { stringValue: 'b' } }
      });

      return client(0)
        .userListens(query)
        .watchAcksFull(query, 250, docA)
        .expectEvents(query, {
          added: [docA]
        })
        .client(1)
        .loadBundle(bundleString1)
        .client(0)
        .becomeVisible();
      // TODO(wuandy): Loading from secondary client does not notify other
      // clients for now. We need to fix it and uncomment below.
      // .expectEvents(query, {
      //   modified: [doc('collection/a', 500, { key: 'b' })],
      // })
    }
  );

  specTest(
    'Load and observe from same secondary client',
    ['multi-client'],
    () => {
      const query = Query.atPath(path('collection'));
      const docA = doc('collection/a', 250, { key: 'a' });
      const bundleString1 = bundleWithDocument({
        key: docA.key,
        readTime: 500,
        createTime: 250,
        updateTime: 500,
        content: { key: { stringValue: 'b' } }
      });

      return client(0)
        .userListens(query)
        .watchAcksFull(query, 250, docA)
        .expectEvents(query, {
          added: [docA]
        })
        .client(1)
        .userListens(query)
        .expectEvents(query, {
          added: [docA]
        })
        .loadBundle(bundleString1)
        .expectEvents(query, {
          modified: [doc('collection/a', 500, { key: 'b' })],
          fromCache: true
        });
    }
  );

  specTest(
    'Load from primary client and observe from secondary',
    ['multi-client'],
    () => {
      const query = Query.atPath(path('collection'));
      const docA = doc('collection/a', 250, { key: 'a' });
      const bundleString1 = bundleWithDocument({
        key: docA.key,
        readTime: 500,
        createTime: 250,
        updateTime: 500,
        content: { key: { stringValue: 'b' } }
      });

      return client(0)
        .userListens(query)
        .watchAcksFull(query, 250, docA)
        .expectEvents(query, {
          added: [docA]
        })
        .client(1)
        .userListens(query)
        .expectEvents(query, {
          added: [docA]
        })
        .client(0)
        .loadBundle(bundleString1)
        .expectEvents(query, {
          modified: [doc('collection/a', 500, { key: 'b' })],
          fromCache: true
        })
        .client(1)
        .expectEvents(query, {
          modified: [doc('collection/a', 500, { key: 'b' })],
          fromCache: true
        });
    }
  );
});
