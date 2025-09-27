require('dotenv').config();
const mysql = require('mysql2/promise');

async function flushDatabase() {
    console.log('Flushing all emails and analyses from database...');

    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'safai123',
            database: process.env.DB_NAME || 'safai_db'
        });

        // Clear all email and analysis data
        await connection.execute('DELETE FROM ai_analyses');
        console.log('✅ Cleared ai_analyses table');

        try {
            await connection.execute('DELETE FROM emails');
            console.log('✅ Cleared emails table');
        } catch (error) {
            if (error.code === 'ER_NO_SUCH_TABLE') {
                console.log('✅ emails table does not exist (no emails to clear)');
            } else {
                throw error;
            }
        }

        // Add annotated_images column if it doesn't exist
        try {
            await connection.execute(`
                ALTER TABLE ai_analyses
                ADD COLUMN annotated_images JSON DEFAULT NULL
            `);
            console.log('✅ Added annotated_images column to ai_analyses table');
        } catch (error) {
            if (error.code === 'ER_DUP_FIELDNAME') {
                console.log('✅ annotated_images column already exists');
            } else {
                throw error;
            }
        }

        // Show table structure
        const [tables] = await connection.execute('SHOW TABLES');
        console.log('\n📋 Available tables:', tables.map(t => Object.values(t)[0]));

        const [columns] = await connection.execute('DESCRIBE ai_analyses');
        console.log('\n🏗️ ai_analyses table structure:');
        columns.forEach(col => {
            console.log(`  - ${col.Field}: ${col.Type} ${col.Null === 'YES' ? '(nullable)' : '(not null)'}`);
        });

        await connection.end();
        console.log('\n🎉 Database flush completed successfully!');

    } catch (error) {
        console.error('❌ Error flushing database:', error.message);
        process.exit(1);
    }
}

flushDatabase();