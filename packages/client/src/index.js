'use strict';

// Both clients are exported lazily so customers don't need both mongodb and
// pg installed — only the one they actually use. Importing the unused peer
// dep would throw on `require('mongodb')` if it isn't installed.
module.exports = {
  get CustomDBMongo() { return require('./mongo').CustomDBMongo; },
  get CustomDBPostgres() { return require('./postgres').CustomDBPostgres; },
};
