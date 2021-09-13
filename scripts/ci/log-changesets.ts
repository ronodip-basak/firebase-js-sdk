/**
 * @license
 * Copyright 2021 Google LLC
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

import { ClientRequest, IncomingMessage } from 'http';

const https = require('https');

async function logChangesets() {
  console.log(process.env.GITHUB_EVENT_PATH);

  if (!process.env.GITHUB_EVENT_PATH) return;

  const prPayload = require(process.env.GITHUB_EVENT_PATH);

  console.log('prPayload', JSON.stringify(prPayload));

  // if (prPayload.title !== 'Version Packages') return;

  const matches = prPayload.body.match(/## firebase@([\d\.]+)/);
  const version = matches[1];

  const data = JSON.stringify({
    version,
    pr: prPayload.number
  });

  const options = {
    hostname: 'us-central1-feature-tracker-8ca2b.cloudfunctions.net',
    path: '/logChangesetPR',
    port: 443,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req: ClientRequest = https.request(
      options,
      (res: IncomingMessage) => {
        res.on('data', d => {
          process.stdout.write(d);
        });
        res.on('end', resolve);
      }
    );

    req.on('error', error => reject(error));

    req.write(data);
    req.end();
  });
}

logChangesets();
