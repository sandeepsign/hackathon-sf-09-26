require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkLatestEmail() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'safai123',
            database: process.env.DB_NAME || 'safai_db'
        });

        const [rows] = await connection.execute(`
            SELECT subject, has_attachments, attachment_analysis,
                   annotated_images, risk_level, analyzed_at
            FROM ai_analyses
            ORDER BY analyzed_at DESC
            LIMIT 5
        `);

        if (rows.length > 0) {
            console.log(`Found ${rows.length} recent email(s):\n`);
            rows.forEach((row, index) => {
                console.log(`=== Email ${index + 1} ===`);
                console.log('Subject:', row.subject);
                console.log('Has attachments:', row.has_attachments);
                console.log('Risk level:', row.risk_level);
                console.log('Analyzed at:', row.analyzed_at);
                console.log('Attachment analysis:', row.attachment_analysis ? JSON.stringify(row.attachment_analysis, null, 2) : 'NULL');
                console.log('Annotated images:', row.annotated_images ? JSON.stringify(row.annotated_images, null, 2) : 'NULL');
                console.log('');
            });

            // Specifically look for the "3D Print it?" email
            const [printRows] = await connection.execute(`
                SELECT subject, has_attachments, attachment_analysis,
                       annotated_images, risk_level, analyzed_at
                FROM ai_analyses
                WHERE subject LIKE '%3D Print%'
                ORDER BY analyzed_at DESC
            `);

            if (printRows.length > 0) {
                console.log('=== "3D Print it?" email found ===');
                const row = printRows[0];
                console.log('Subject:', row.subject);
                console.log('Has attachments:', row.has_attachments);
                console.log('Risk level:', row.risk_level);
                console.log('Analyzed at:', row.analyzed_at);
                console.log('Attachment analysis:', row.attachment_analysis ? JSON.stringify(row.attachment_analysis, null, 2) : 'NULL');
                console.log('Annotated images:', row.annotated_images ? JSON.stringify(row.annotated_images, null, 2) : 'NULL');
            } else {
                console.log('No "3D Print it?" email found in database');
            }
        } else {
            console.log('No emails found in database');
        }

        await connection.end();
    } catch (error) {
        console.error('Database error:', error);
    }
}

checkLatestEmail();