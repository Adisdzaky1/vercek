const fs = require('fs');
const pg = require('pg');
const url = require('url');

const connectionString = 'postgresql://postgres.uuqfnngkeheonzancwlt:Asep@@12344@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';

// Buat Pool untuk koneksi database
const client = new pg.Client({
    connectionString,
    ssl: {
        rejectUnauthorized: false // Atur SSL jika diperlukan
    },
});


async function createUsersTable() {
    try {
        await client.connect();

        // SQL query to create the 'users' table if it doesn't exist
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                vps TEXT
            );
        `;

        // Execute the query
        await client.query(createTableQuery);
        console.log("Table 'users' created or already exists.");
    } catch (err) {
        console.error('Error creating table:', err);
    } finally {
        await client.end();
    }
}

// Call the function to create the table
createUsersTable();
