// Dump every user database to a lossless, gzipped EJSON archive.
// Usage: node scripts/db-backup.cjs [--shutdown]   (expects mongod on 127.0.0.1:27117)
// Restore with: node scripts/db-restore.cjs db-backup/<archive>
const { MongoClient } = require("mongodb");
const { EJSON } = require("bson");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const URI = "mongodb://127.0.0.1:27117";
const SYSTEM_DBS = ["admin", "config", "local"];

(async () => {
    const client = await MongoClient.connect(URI, { serverSelectionTimeoutMS: 5000 });
    const outDir = path.join(__dirname, "..", "db-backup");
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
    const outFile = path.join(outDir, `openwf-db-${stamp}.ndjson.gz`);
    const gzip = zlib.createGzip({ level: 9 });
    const output = fs.createWriteStream(outFile);
    gzip.pipe(output);
    const write = line =>
        new Promise((resolve, reject) => {
            gzip.write(line + "\n", err => (err ? reject(err) : resolve()));
        });

    let docs = 0;
    const dbs = (await client.db().admin().listDatabases()).databases.map(d => d.name);
    for (const dbName of dbs) {
        if (SYSTEM_DBS.includes(dbName)) continue;
        const db = client.db(dbName);
        for (const coll of await db.listCollections().toArray()) {
            const cursor = db.collection(coll.name).find({});
            for await (const doc of cursor) {
                // canonical EJSON round-trips ObjectId/Date/Long/Binary losslessly
                await write(
                    JSON.stringify({ db: dbName, coll: coll.name, doc: EJSON.serialize(doc, { relaxed: false }) })
                );
                docs++;
            }
            console.log(`dumped ${dbName}.${coll.name}`);
        }
    }
    await new Promise((resolve, reject) => {
        gzip.once("error", reject);
        output.once("error", reject);
        output.once("finish", resolve);
        gzip.end();
    });
    console.log(`OK: ${docs} documents -> ${outFile} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);

    if (process.argv.includes("--shutdown")) {
        try {
            await client.db("admin").command({ shutdown: 1 });
        } catch {
            // connection drops as mongod exits - expected
        }
        console.log("mongod shutdown requested");
    }
    await client.close().catch(() => {});
    process.exit(0);
})().catch(e => {
    console.error("BACKUP FAILED:", e.message);
    process.exit(1);
});
