import fs from 'fs'
import path from 'path'
import { pool } from './db'

async function run() {
  const file = path.resolve(__dirname, '../migrations/001_create_tables.sql')
  const sql = fs.readFileSync(file, 'utf8')
  try {
    await pool.query(sql)
    console.log('Migration applied: 001_create_tables')
    await pool.end()
    process.exit(0)
  } catch (err) {
    console.error('Migration failed', err)
    process.exit(1)
  }
}

run()
