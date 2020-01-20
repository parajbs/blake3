import webpack from 'webpack';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import handler from 'serve-handler';
import puppeteer from 'puppeteer';
import { Server, createServer } from 'http';
import { AddressInfo } from 'net';
import { inputs, hello48 } from './base/test-helpers';
import { tmpdir } from 'os';
import { expect } from 'chai';

// Much of the browser code is also used in Node's wasm. We test things more
// thoroughly there because tests are easier to write and debug, these tests
// are primarily for sanity and checking browser-specific behavior.
describe('browser', () => {
  const testDir = resolve(tmpdir(), 'blake3-browser-test');
  let server: Server;
  let page: puppeteer.Page;

  /**
   * Builds the browser lib into the testDir.
   */
  async function buildWebpack() {
    try {
      mkdirSync(testDir);
    } catch {
      // already exists, probably
    }

    writeFileSync(
      resolve(testDir, 'entry-src.js'),
      `import("blake3/browser").then(b3 => window.blake3 = b3);`,
    );

    const stats = await new Promise<webpack.Stats>((res, rej) =>
      webpack(
        {
          mode: 'development',
          entry: resolve(testDir, 'entry-src.js'),
          output: {
            path: testDir,
            filename: 'main.js',
          },
          resolve: {
            alias: {
              'blake3/browser': resolve(__dirname, '../', 'browser.js'),
            },
          },
        },
        (err, stats) => (err ? rej(err) : res(stats)),
      ),
    );

    if (stats.hasErrors()) {
      throw stats.toString('errors-only');
    }

    writeFileSync(
      resolve(testDir, 'index.html'),
      `
      <script src="/main.js"></script>
      <script>window.inputs = ${JSON.stringify(inputs)}</script>
    `,
    );
  }

  async function serve() {
    server = createServer((req, res) => handler(req, res, { public: testDir }));
    await new Promise(resolve => server.listen(0, resolve));
  }

  before(async function() {
    await buildWebpack();
    await serve();

    this.timeout(20 * 1000);

    const { port } = server.address() as AddressInfo;
    const browser = await puppeteer.launch();
    page = await browser.newPage();
    await page.goto(`http://localhost:${port}`);
    await page.waitForFunction('!!window.blake3');
  });

  it('hashes a string', async () => {
    const result = await page.evaluate('blake3.hash(inputs.large.input).toString("hex")');
    expect(result).to.equal(inputs.large.hash.toString('hex'));
  });

  describe('input encoding', () => {
    it('hashes a uint8array', async () => {
      const contents = [...new Uint8Array(Buffer.from(inputs.hello.input))];
      const result = await page.evaluate(
        `blake3.hash(new Uint8Array([${contents.join(',')}])).toString("hex")`,
      );
      expect(result).to.equal(inputs.hello.hash.toString('hex'));
    });

    it('hashes a string', async () => {
      const result = await page.evaluate('blake3.hash(inputs.large.input).toString("hex")');
      expect(result).to.equal(inputs.large.hash.toString('hex'));
    });

    it('customizes output length', async () => {
      const result = await page.evaluate(
        'blake3.hash(inputs.hello.input, { length: 16 }).toString("hex")',
      );
      expect(result).to.equal(inputs.hello.hash.slice(0, 16).toString('hex'));
    });
  });

  describe('output encoding', () => {
    const tcases = [
      { encoding: 'hex', expected: inputs.hello.hash.toString('hex') },
      { encoding: 'base64', expected: inputs.hello.hash.toString('base64') },
      { encoding: 'utf8', expected: inputs.hello.hash.toString('utf8') },
    ];

    tcases.forEach(({ encoding, expected }) =>
      it(encoding, async () => {
        const result = await page.evaluate(
          `blake3.hash(inputs.hello.input).toString("${encoding}")`,
        );
        expect(result).to.deep.equal(expected);
      }),
    );

    it('raw', async () => {
      const result = (await page.evaluate(`blake3.hash(inputs.hello.input)`)) as {
        length: number;
        [n: number]: number;
      };
      const actual = Buffer.alloc(32);
      for (let i = 0; i < actual.length; i++) {
        actual[i] = result[i]; // it comes as a plain object, we need to convert it to a buffer
      }
      expect(actual).to.deep.equal(inputs.hello.hash);
    });
  });

  describe('hash class', () => {
    it('digests', async () => {
      const result = await page.evaluate(`(() => {
        const hash = blake3.createHash();
        ${[...Buffer.from(inputs.hello.input)]
          .map(byte => `hash.update(new Uint8Array([${byte}]));`)
          .join('\n')}
        return hash.digest('hex');
      })()`);

      expect(result).to.equal(inputs.hello.hash.toString('hex'));
    });

    it('customizes the output length', async () => {
      const result = await page.evaluate(`(() => {
        const hash = blake3.createHash();
        hash.update(${JSON.stringify(inputs.hello.input)});
        return hash.digest('hex', { length: 16 });
      })()`);

      expect(result).to.equal(inputs.hello.hash.slice(0, 16).toString('hex'));
    });

    it('returns a hash instance from digest', async () => {
      const result = await page.evaluate(`(() => {
        const hash = blake3.createHash();
        ${[...Buffer.from(inputs.hello.input)]
          .map(byte => `hash.update(new Uint8Array([${byte}]));`)
          .join('\n')}
        return hash.digest('hex');
      })()`);

      expect(result).to.equal(inputs.hello.hash.toString('hex'));
    });
  });

  describe('reader', () => {
    it('is sane with a Hash', async () => {
      const result = await page.evaluate(`(() => {
        const hash = blake3.createHash();
        hash.update("hello");

        return blake3.using(hash.reader(), reader => [
          reader.read(48).toString('hex'),
          reader.toArray().toString('hex'),
          reader.toString('hex'),
        ]);
      })()`);

      expect(result).to.deep.equal([
        hello48.toString('hex'),
        inputs.hello.hash.toString('hex'),
        inputs.hello.hash.toString('hex'),
      ]);
    });
  });

  after(() => {
    page?.browser().close();
    server?.close();
  });
});