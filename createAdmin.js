// createAdmin.js
require('dotenv').config({ path: './.env' });
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function createAdmin() {
    console.log('🚀 جاري إنشاء الأدمن الرئيسي...\n');
    
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'stag_io_platform',
        port: process.env.DB_PORT || 3306
    });

    try {
        console.log('🔍 التحقق من وجود أدمن مسبقاً...');
        
        const [existing] = await connection.execute(
            "SELECT COUNT(*) as count FROM users WHERE user_type = 'admin'"
        );
        
        if (existing[0].count > 0) {
            console.log('⚠️  يوجد أدمن مسبقاً في النظام!');
            console.log('💡 لحذف الأدمن الحالي: DELETE FROM users WHERE user_type = "admin"');
            return;
        }

        const adminEmail = 'admin@stag.io';
        const adminPassword = 'Admin@1234';
        
        console.log('🔐 جاري تشفير كلمة المرور...');
        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        console.log('📝 جاري إنشاء حساب الأدمن...');
        const [result] = await connection.execute(
            `INSERT INTO users 
            (email, password, user_type, is_verified, created_at) 
            VALUES (?, ?, ?, ?, NOW())`,
            [adminEmail, hashedPassword, 'admin', 1]
        );

        const userId = result.insertId;
        
        console.log('\n✅ تم بنجاح!');
        console.log('========================================');
        console.log('👑 البيانات:');
        console.log('📧 البريد:', adminEmail);
        console.log('🔑 كلمة المرور:', adminPassword);
        console.log('🆔 رقم المستخدم:', userId);
        console.log('========================================\n');
        
        console.log('💾 احفظ هذه البيانات:');
        console.log('EMAIL: admin@stag.io');
        console.log('PASSWORD: Admin@1234');
        console.log('\n🚀 يمكنك الآن تسجيل الدخول!');
        console.log('🔗 http://localhost:3000/login');

    } catch (error) {
        console.error('❌ خطأ:', error.message);
        console.log('💡 تأكد من:');
        console.log('1. تشغيل XAMPP (MySQL)');
        console.log('2. قاعدة البيانات موجودة:', process.env.DB_NAME);
    } finally {
        await connection.end();
        process.exit();
    }
}

// تشغيل الوظيفة
createAdmin();