/*!
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const assert = require('assert');
const extend = require('extend');
const proxyquire = require('proxyquire');
const {split} = require('split-array-stream');
const through = require('through2');
const {util} = require('@google-cloud/common-grpc');
const pfy = require('@google-cloud/promisify');

let promisified = false;
const fakePfy = extend({}, pfy, {
  promisifyAll: function(Class, options) {
    if (Class.name !== 'Table') {
      return;
    }
    promisified = true;
    assert.deepStrictEqual(options.exclude, ['delete']);
  },
});

function FakeTransactionRequest() {}

describe('Table', function() {
  let Table;
  let TableCached;
  let table;

  const DATABASE = {
    api: {},
    makePooledRequest_: function() {
      return util.noop;
    },
    makePooledStreamingRequest_: function() {
      return util.noop;
    },
  };

  const NAME = 'table-name';

  before(function() {
    Table = proxyquire('../src/table.js', {
      '@google-cloud/promisify': fakePfy,
      './transaction-request.js': FakeTransactionRequest,
    });
    TableCached = extend({}, Table);
  });

  beforeEach(function() {
    extend(Table, TableCached);
    table = new Table(DATABASE, NAME);
  });

  describe('instantiation', function() {
    it('should promisify all the things', function() {
      assert(promisified);
    });

    it('should localize API', function() {
      assert.strictEqual(table.api, DATABASE.api);
    });

    it('should localize database', function() {
      assert.strictEqual(table.database, DATABASE);
    });

    it('should localize name', function() {
      assert.strictEqual(table.name, NAME);
    });

    it('should localize request from pool', function() {
      assert.strictEqual(table.request(), util.noop);
    });

    it('should localize requestStream from pool', function() {
      assert.strictEqual(table.requestStream(), util.noop);
    });

    it('should inherit from TransactionRequest', function() {
      assert(table instanceof FakeTransactionRequest);
    });
  });

  describe('create', function() {
    it('should create a table from the database', function(done) {
      const schema = 'schema';

      table.database = {
        createTable: function(schema_, callback) {
          assert.strictEqual(schema_, schema);
          callback(); // done()
        },
      };

      table.create(schema, done);
    });
  });

  describe('createReadStream', function() {
    it('should call and return parent method', function() {
      const query = 'SELECT * from Everything';

      const parentMethodReturnValue = {};

      FakeTransactionRequest.prototype = {
        createReadStream: function(name, query_) {
          assert.strictEqual(this, table);
          assert.strictEqual(name, table.name);
          assert.deepStrictEqual(query_, {
            keys: query,
          });
          return parentMethodReturnValue;
        },
      };

      const readStream = table.createReadStream(query);
      assert.strictEqual(readStream, parentMethodReturnValue);
    });

    it('should accept an array of keys', function(done) {
      const QUERY = ['a', 'b'];

      FakeTransactionRequest.prototype = {
        createReadStream: function(name, query) {
          assert.strictEqual(query.keys, QUERY);
          done();
        },
      };

      table.createReadStream(QUERY);
    });

    it('should support timestamp options', function(done) {
      const QUERY = 'SELECT * from Everything';
      const OPTIONS = {};
      const FORMATTED_OPTIONS = {};

      const formatTimestampOptions =
        FakeTransactionRequest.formatTimestampOptions;

      FakeTransactionRequest.formatTimestampOptions_ = function(options) {
        assert.strictEqual(options, OPTIONS);
        return FORMATTED_OPTIONS;
      };

      FakeTransactionRequest.prototype = {
        createReadStream: function(name, query) {
          FakeTransactionRequest.formatTimestampOptions_ = formatTimestampOptions;

          assert.strictEqual(
            query.transaction.singleUse.readOnly,
            FORMATTED_OPTIONS
          );

          setImmediate(done);
          return {};
        },
      };

      table.createReadStream(QUERY, OPTIONS);
    });
  });

  describe('delete', function() {
    it('should update the schema on the database', function() {
      const updateSchemaReturnValue = {};

      function callback() {}

      table.database = {
        updateSchema: function(schema, callback_) {
          assert.strictEqual(schema, 'DROP TABLE `' + table.name + '`');
          assert.strictEqual(callback_, callback);
          return updateSchemaReturnValue;
        },
      };

      const returnValue = table.delete(callback);
      assert.strictEqual(returnValue, updateSchemaReturnValue);
    });
  });

  describe('deleteRows', function() {
    it('should call and return parent method', function() {
      const keys = [];

      function callback() {}

      const parentMethodReturnValue = {};

      FakeTransactionRequest.prototype = {
        deleteRows: function(name, keys_, callback_) {
          assert.strictEqual(this, table);
          assert.strictEqual(name, table.name);
          assert.strictEqual(keys_, keys);
          assert.strictEqual(callback_, callback);
          return parentMethodReturnValue;
        },
      };

      const returnValue = table.deleteRows(keys, callback);
      assert.strictEqual(returnValue, parentMethodReturnValue);
    });
  });

  describe('insert', function() {
    it('should call and return mutate_ method', function() {
      const mutateReturnValue = {};

      const keyVals = [];

      function callback() {}

      table.mutate_ = function(method, name, keyVals_, callback_) {
        assert.strictEqual(method, 'insert');
        assert.strictEqual(name, table.name);
        assert.strictEqual(keyVals_, keyVals);
        assert.strictEqual(callback_, callback);
        return mutateReturnValue;
      };

      const returnValue = table.insert(keyVals, callback);
      assert.strictEqual(returnValue, mutateReturnValue);
    });
  });

  describe('read', function() {
    it('should call and collect results from a stream', function(done) {
      const keyVals = [];

      const rows = [{}, {}];

      table.createReadStream = function(keyVals_, options) {
        assert.strictEqual(keyVals_, keyVals);
        assert.strictEqual(options, null);

        const stream = through.obj();

        setImmediate(function() {
          split(rows, stream).then(function() {
            stream.end();
          });
        });

        return stream;
      };

      table.read(keyVals, function(err, rows_) {
        assert.ifError(err);
        assert.deepStrictEqual(rows_, rows);
        done();
      });
    });

    it('should accept an options object', function(done) {
      const OPTIONS = {};

      table.createReadStream = function(keyVals, options) {
        assert.strictEqual(OPTIONS, options);

        const stream = through.obj();

        setImmediate(function() {
          stream.end();
        });

        return stream;
      };

      table.read([], OPTIONS, done);
    });

    it('should execute callback with error', function(done) {
      const error = new Error('Error.');

      table.createReadStream = function() {
        const stream = through.obj();

        setImmediate(function() {
          stream.destroy(error);
        });

        return stream;
      };

      table.read([], function(err) {
        assert.strictEqual(err, error);
        done();
      });
    });
  });

  describe('replace', function() {
    it('should call and return mutate_ method', function() {
      const mutateReturnValue = {};

      const keyVals = [];

      function callback() {}

      table.mutate_ = function(method, name, keyVals_, callback_) {
        assert.strictEqual(method, 'replace');
        assert.strictEqual(name, table.name);
        assert.strictEqual(keyVals_, keyVals);
        assert.strictEqual(callback_, callback);
        return mutateReturnValue;
      };

      const returnValue = table.replace(keyVals, callback);
      assert.strictEqual(returnValue, mutateReturnValue);
    });
  });

  describe('update', function() {
    it('should call and return mutate_ method', function() {
      const mutateReturnValue = {};

      const keyVals = [];

      function callback() {}

      table.mutate_ = function(method, name, keyVals_, callback_) {
        assert.strictEqual(method, 'update');
        assert.strictEqual(name, table.name);
        assert.strictEqual(keyVals_, keyVals);
        assert.strictEqual(callback_, callback);
        return mutateReturnValue;
      };

      const returnValue = table.update(keyVals, callback);
      assert.strictEqual(returnValue, mutateReturnValue);
    });
  });

  describe('upsert', function() {
    it('should call and return mutate_ method', function() {
      const mutateReturnValue = {};

      const keyVals = [];

      function callback() {}

      table.mutate_ = function(method, name, keyVals_, callback_) {
        assert.strictEqual(method, 'insertOrUpdate');
        assert.strictEqual(name, table.name);
        assert.strictEqual(keyVals_, keyVals);
        assert.strictEqual(callback_, callback);
        return mutateReturnValue;
      };

      const returnValue = table.upsert(keyVals, callback);
      assert.strictEqual(returnValue, mutateReturnValue);
    });
  });
});
