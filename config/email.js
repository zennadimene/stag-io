// config/email.js
const nodemailer = require('nodemailer');

// تكوين البريد الإلكتروني
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
});

// دالة إرسال البريد الإلكتروني
const sendEmail = async ({ to, subject, html, text }) => {
    try {
        // إذا لم تكن هناك إعدادات بريد حقيقية، فقط سجل في الكونسول
        if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your-email@gmail.com') {
            console.log('📧 Email would be sent (DEMO MODE):', { to, subject });
            console.log('📧 HTML:', html ? html.substring(0, 200) + '...' : 'No HTML');
            return { success: true, demo: true };
        }

        const mailOptions = {
            from: `"Stag.io Platform" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
            text
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Email error:', error);
        // في حالة الفشل، لا توقف التطبيق - فقط سجل الخطأ
        console.log('📧 Email sending failed, but continuing...');
        return { success: false, error: error.message, demo: true };
    }
};

// قوالب البريد الإلكتروني
const emailTemplates = {
    // قالب التحقق من البريد الإلكتروني
    verification: (name, link) => ({
        subject: '✅ Verify Your Email - Stag.io',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #6b46c1;">🎓 Stag.io</h1>
                </div>
                
                <h2 style="color: #333;">Welcome, ${name}!</h2>
                
                <p style="color: #555; font-size: 16px; line-height: 1.5;">
                    Thank you for registering with Stag.io. Please verify your email address to complete your registration.
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${link}" 
                       style="background: linear-gradient(to right, #6b46c1, #4299e1); 
                              color: white; 
                              padding: 15px 30px; 
                              text-decoration: none; 
                              border-radius: 50px;
                              font-weight: bold;
                              display: inline-block;">
                        ✅ Verify Email Address
                    </a>
                </div>
                
                <p style="color: #777; font-size: 14px;">
                    If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="color: #4299e1; font-size: 14px; word-break: break-all;">
                    ${link}
                </p>
                
                <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    This link will expire in 24 hours.<br>
                    If you didn't create an account, please ignore this email.
                </p>
            </div>
        `
    }),

    // قالب إعادة تعيين كلمة المرور
    resetPassword: (name, link) => ({
        subject: '🔐 Reset Your Password - Stag.io',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #6b46c1;">🎓 Stag.io</h1>
                </div>
                
                <h2 style="color: #333;">Hello, ${name}!</h2>
                
                <p style="color: #555; font-size: 16px; line-height: 1.5;">
                    We received a request to reset your password. Click the button below to set a new password.
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${link}" 
                       style="background: linear-gradient(to right, #f97316, #f59e0b); 
                              color: white; 
                              padding: 15px 30px; 
                              text-decoration: none; 
                              border-radius: 50px;
                              font-weight: bold;
                              display: inline-block;">
                        🔑 Reset Password
                    </a>
                </div>
                
                <p style="color: #777; font-size: 14px;">
                    If you didn't request this, please ignore this email. Your password will remain unchanged.
                </p>
                
                <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
                
                <p style="color: #999; font-size: 12px; text-align: center;">
                    This link will expire in 1 hour for security reasons.
                </p>
            </div>
        `
    }),

    // ✅ قالب قبول الطالب - مصحح (استخدمنا علامات اقتباس مزدوجة)
    studentAccepted: (studentName, companyName, internshipTitle) => ({
        subject: "🎉 Congratulations! You've Been Accepted - Stag.io",  // ✅ مصحح
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <div style="font-size: 60px;">🎉</div>
                    <h1 style="color: #10b981;">Congratulations!</h1>
                </div>
                
                <h2 style="color: #333;">Dear ${studentName},</h2>
                
                <p style="color: #555; font-size: 16px; line-height: 1.5;">
                    Great news! <strong style="color: #6b46c1;">${companyName}</strong> has accepted your application for:
                </p>
                
                <div style="background: #f3f4f6; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <p style="font-size: 18px; font-weight: bold; color: #333; margin: 0;">
                        ${internshipTitle}
                    </p>
                </div>
                
                <p style="color: #555; font-size: 16px; line-height: 1.5;">
                    Please log in to your dashboard to view and sign the internship agreement.
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="http://localhost:3000/student/dashboard" 
                       style="background: #10b981; 
                              color: white; 
                              padding: 15px 30px; 
                              text-decoration: none; 
                              border-radius: 50px;
                              font-weight: bold;
                              display: inline-block;">
                        📋 Go to Dashboard
                    </a>
                </div>
            </div>
        `
    }),

    // قالب موافقة الشركة
    companyApproved: (companyName) => ({
        subject: '✅ Company Account Approved - Stag.io',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #6b46c1;">🎓 Stag.io</h1>
                </div>
                
                <h2 style="color: #333;">Hello ${companyName}!</h2>
                
                <p style="color: #555; font-size: 16px; line-height: 1.5;">
                    Great news! Your company account has been <strong style="color: #10b981;">approved</strong> by our team.
                </p>
                
                <p style="color: #555; font-size: 16px; line-height: 1.5;">
                    You can now:
                </p>
                
                <ul style="color: #555; font-size: 16px; line-height: 1.5;">
                    <li>✅ Post internship opportunities</li>
                    <li>✅ Review student applications</li>
                    <li>✅ Manage your company profile</li>
                    <li>✅ Communicate with candidates</li>
                </ul>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="http://localhost:3000/company/dashboard" 
                       style="background: linear-gradient(to right, #6b46c1, #4299e1); 
                              color: white; 
                              padding: 15px 30px; 
                              text-decoration: none; 
                              border-radius: 50px;
                              font-weight: bold;
                              display: inline-block;">
                        🚀 Go to Company Dashboard
                    </a>
                </div>
            </div>
        `
    })
};

module.exports = { sendEmail, emailTemplates };