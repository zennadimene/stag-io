
const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    //host: process.env.DB_HOST || 'localhost',
    host: process.env.DB_HOST,
    //user: process.env.DB_USER || 'root',
    user: process.env.DB_USER,
    //password: process.env.DB_PASSWORD || '',
    //database: process.env.DB_NAME || 'stag_io_platform',
    //port: process.env.DB_PORT || 3306,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    //add
    ssl: {
    rejectUnauthorized: false
},
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

const db = pool.promise();

db.checkAndUpdateTables = async () => {
    const connection = await pool.promise().getConnection();
    
    try {
        console.log('🔍 Checking database table structure...');
        
        try {
            const [tables] = await connection.query(
                "SHOW TABLES LIKE 'students'"
            );
            
            if (tables.length === 0) {
                console.log('❌ Students table does not exist');
                return;
            }
        } catch (error) {
            console.log('❌ Error checking tables:', error.message);
            return;
        }
        
        const [columns] = await connection.query(`
            SHOW COLUMNS FROM students
        `);
        
        const existingColumns = columns.map(col => col.Field);
        console.log('📊 Existing columns in students table:', existingColumns);
        
        const columnsToAdd = [
            { name: 'wilaya', type: 'VARCHAR(100)' },
            { name: 'bio', type: 'TEXT' },
            { name: 'skills', type: 'TEXT' }, 
            { name: 'cv_url', type: 'VARCHAR(255)' },
            { name: 'updated_at', type: 'TIMESTAMP' }
        ];
        
        for (const column of columnsToAdd) {
            if (!existingColumns.includes(column.name)) {
                console.log(`➕ Adding column ${column.name} to students table...`);
                try {
                    let sql = `ALTER TABLE students ADD COLUMN ${column.name} ${column.type}`;
                    
                    if (column.name === 'updated_at') {
                        sql += ' DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP';
                    }
                    
                    await connection.execute(sql);
                    console.log(`✅ Column ${column.name} added successfully`);
                } catch (error) {
                    console.log(`⚠️ Could not add column ${column.name}:`, error.message);
                }
            } else {
                console.log(`✓ Column ${column.name} already exists`);
            }
        }
        
        console.log('✅ Database table structure check completed');
        
    } catch (error) {
        console.error('❌ Error checking/updating tables:', error.message);
    } finally {
        connection.release();
    }
};

db.executeQuery = async (sql, params) => {
    return await db.execute(sql, params);
};

module.exports = db;
