// Singleton PrismaClient for the `platform` schema — replaces db/platform.js.
// One connection for the process lifetime, same as the old singleton DatabaseSync.
const { PrismaClient } = require('../../node_modules/.prisma/platform-client');
const { platformUrl } = require('./tenantSchema');

const platformClient = new PrismaClient({ datasourceUrl: platformUrl() });

module.exports = platformClient;
