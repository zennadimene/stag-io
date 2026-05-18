
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mysql = require('mysql2');

console.log('🔥🔥🔥 CRITICAL: This is the NEW version of authController.js');
console.log('🔥🔥🔥 Login function should have version 2.0 logs');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'stag_io_platform',
    port: process.env.DB_PORT || 3306
}).promise();

const db = {
    execute: async (sql, params) => {
        return await pool.execute(sql, params);
    },
    query: async (sql, params) => {
        return await pool.query(sql, params);
    }
};

const login = async (req, res) => {
    try {
        console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
        console.log('🔥 THIS IS THE NEW LOGIN FUNCTION - VERSION 3.0');
        console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false,
                message: 'Please enter email and password' 
            });
        }

        const [users] = await db.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        
        if (users.length === 0) { 
            return res.status(401).json({ 
                success: false,
                message: 'Invalid email or password' 
            });
        }
        
        const user = users[0];

        if (user.is_suspended === 1) {
            console.log(`⛔ Login blocked: User ${user.id} is suspended`);
            return res.status(403).json({
                success: false,
                message: 'Your account has been suspended. Please contact administrator.',
                suspended: true
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false,
                message: 'Invalid email or password' 
            });
        }

        const isVerified = user.is_verified === 1 || user.is_verified === true;

        if (!isVerified && user.user_type !== 'admin') {

            if (user.user_type === 'company') {
                return res.status(403).json({
                    success: false,
                    message: 'Your company account is pending approval...',
                    needsVerification: true,
                    pending: true,
                    redirectTo: '/company/pending'
                });

            } else if (user.user_type === 'student') {
                return res.status(403).json({
                    success: false,
                    message: 'Please verify your email first...',
                    needsVerification: true
                });
            }
        }

        const token = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                user_type: user.user_type 
            },
            process.env.JWT_SECRET || 'fallback_secret_key',
            { expiresIn: '7d' }
        );

        let profile = null;
        if (user.user_type === 'student') {

            const [students] = await db.execute(
                'SELECT * FROM students WHERE user_id = ?',
                [user.id]
            );
            profile = students[0];

        } else if (user.user_type === 'company') {
            const [companies] = await db.execute(
                'SELECT * FROM companies WHERE user_id = ?',
                [user.id]
            );
            profile = companies[0];
        }

        const dashboardRoutes = {
            'student': '/student/dashboard',
            'company': '/company/dashboard',
            'admin': '/admin/dashboard'
        };

        if (user.is_suspended !== 1) {
        console.log(`✅✅✅ Login successful: ${email} (${user.user_type}) - ACTIVE USER`);
        }
       

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                user_type: user.user_type,
                is_verified: isVerified
            },
            profile,
            redirectTo: dashboardRoutes[user.user_type]
        });
        
    } catch (error) {
        console.error('🔥 Login error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error' 
        });
    }
};



const registerStudent = async (req, res) => {
    try {
        const { 
            first_name, 
            last_name, 
            university_email, 
            password, 
            university, 
            specialization, 
            year_of_study,
            phone,
            birth_date,
            student_id,
            skills,
            github_link,
            linkedin_link,
            training_type,
            preferred_wilaya,
            expected_start_date 
        } = req.body;
        
        const algerianUniversityRegex = /^[a-zA-Z]+\.[a-zA-Z]+@univ-[a-zA-Z]+[0-9]*\.dz$/;
        if (!algerianUniversityRegex.test(university_email)) {
            return res.status(400).json({ 
                success: false,
                message: 'Please use your university email only. Format: firstname.lastname@univ-[university].dz' 
            });
        }

        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [university_email]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Email already registered' 
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const [userResult] = await db.execute(
            'INSERT INTO users (email, password, user_type, is_verified) VALUES (?, ?, ?, ?)',
            [university_email, hashedPassword, 'student', 1]
        );

        await db.execute(
            `INSERT INTO students 
            (user_id, first_name, last_name, university_email, university, specialization, 
             year_of_study, phone, birth_date, student_id, skills, github_link, linkedin_link,
             training_type, preferred_wilaya, expected_start_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userResult.insertId, 
                first_name, 
                last_name, 
                university_email, 
                university, 
                specialization, 
                year_of_study,
                phone || null,
                birth_date || null,
                student_id || null,
                skills ? JSON.stringify(skills) : null,
                github_link || null,
                linkedin_link || null,
                training_type || null,
                preferred_wilaya || null,
                expected_start_date || null
            ]
        );

       try {
       const notificationMessage = `${first_name} ${last_name} has registered as a new student.`;
    
       await db.execute(
        `INSERT INTO admin_notifications (type, title, message, student_id, created_at) 
         VALUES (?, ?, ?, ?, NOW())`,
        ['student_register', '👨‍🎓 New Student Registration', notificationMessage, userResult.insertId]
    );
    
    console.log('✅ Admin notification created for new student');
    
    const io = req.app.get('io');
    if (io) {
        io.emit('new_notification', {
            type: 'student_register',
            title: '👨‍🎓 New Student Registration',
            message: notificationMessage,
            student_id: userResult.insertId,
            created_at: new Date()
        });
    }
} catch (notifError) {
    console.error('❌ Error creating admin notification:', notifError);
}

        const token = jwt.sign(
            { 
                id: userResult.insertId,
                email: university_email,
                user_type: 'student' 
            },
            process.env.JWT_SECRET || 'fallback_secret_key',
            { expiresIn: '7d' }
        );

        const [newUser] = await db.execute(
            'SELECT id, email, user_type, is_verified FROM users WHERE id = ?',
            [userResult.insertId]
        );

        const [studentData] = await db.execute(
            'SELECT * FROM students WHERE user_id = ?',
            [userResult.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Student registered and logged in successfully!',
            token: token,
            user: {
                id: newUser[0].id,
                email: newUser[0].email,
                user_type: newUser[0].user_type,
                is_verified: newUser[0].is_verified === 1
            },
            profile: studentData[0],
            redirectTo: '/student/dashboard'
        });
        
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error'  
        });
    }
};


const registerCompany = async (req, res) => {
    try {
        console.log('=== COMPANY REGISTRATION START ===');
        console.log('Request body:', req.body);
        
        const { 
            company_name, 
            company_email, 
            password, 
            contact_person, 
            phone,
            trade_register,
            activity_sector,
            wilaya,
            position,
            address,
            website,
            description,
            company_size,
            personal_email
        } = req.body;
        
        if (!company_name || !company_email || !password || !contact_person || !phone || 
            !position || !trade_register || !activity_sector || !wilaya) {
            return res.status(400).json({ 
                success: false,
                message: 'Please enter all required fields: email, password, company name, contact person, phone, position, trade register, activity sector, wilaya'
            });
        }
        
        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [company_email]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Email already registered' 
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const [userResult] = await db.execute(
            'INSERT INTO users (email, password, user_type, is_verified) VALUES (?, ?, ?, ?)',
            [company_email, hashedPassword, 'company', 0]  
        );

        console.log('User created with ID:', userResult.insertId);
        
        const companySql = `
            INSERT INTO companies 
            (user_id, company_name, company_email, contact_person, phone, trade_register, 
             activity_sector, wilaya, position, address, website, description, 
             company_size, personal_email) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const companyParams = [
            userResult.insertId, 
            company_name, 
            company_email, 
            contact_person, 
            phone || '',
            trade_register,
            activity_sector,
            wilaya,
            position,
            address || '',
            website || '',
            description || '',
            company_size || '',
            personal_email || ''
        ];
        
        console.log('Executing company SQL:', companySql);
        console.log('With params:', companyParams);
        
        await db.execute(companySql, companyParams);
        
        console.log('Company profile created successfully');

        const [newUser] = await db.execute(
            'SELECT id, email, user_type, is_verified FROM users WHERE id = ?',
            [userResult.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Company registered successfully! Your account is pending approval. You will be notified once verified.',
            user: {
                id: userResult.insertId,
                email: company_email,
                user_type: 'company',
                is_verified: false  
            }
        });
    } catch (error) {
        console.error('=== COMPANY REGISTRATION ERROR ===');
        console.error('Error:', error.message);
        console.error('Full error:', error);
        
        if (error.message.includes('column') && error.message.includes('cannot be null')) {
            return res.status(400).json({ 
                success: false,
                message: 'Missing required fields. Please fill all required information.',
                error: error.message
            });
        }
        
        res.status(500).json({ 
            success: false,
            message:'Server error',
            error: error.message 
        });
    }
};

const getMe = async (req, res) => {
    try {

        if (!req.user) {
            return res.status(401).json({ 
                success: false,
                message: 'Unauthorized'  
            });
        }

        res.json({
            success: true,
            user: req.user
        });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error' 
        });
    }
};



const forgotPassword = async (req, res) => {
  try {
 
    const { email } = req.body;
    
    console.log('📧 Forgot password request for:', email);
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }
    
    const [users] = await db.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email'
      });
    }
    
    const user = users[0];
    
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 3600000); 
    
    await db.execute(
      'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?',
      [resetToken, resetExpiry, user.id]
    );
    
    const resetLink = `http://localhost:3000/reset-password/${resetToken}`;
    
    console.log('📧 Password reset link:', resetLink);
    
    res.json({
      success: true,
      message: 'Password reset link sent to your email',
      resetLink: resetLink,  
      email: email
    });
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending reset link'
    });
  }
};


const verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;
    
    const [users] = await db.execute(
      'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
      [token]
    );
    
    res.json({
      success: true,
      valid: users.length > 0
    });
    
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({
      success: false,
      valid: false
    });
  }
};



const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;
    
    const [users] = await db.execute(
      'SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()',
      [token]
    );
    
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }
    
    const user = users[0];
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
     
    await db.execute(
      'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );
    
    res.json({
      success: true,
      message: 'Password reset successfully'
    });
    
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password'
    });
  }
};


const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    
    const [result] = await db.execute(
      'UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE verification_token = ?',
      [token]
    );
    
    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }
    
    res.json({
      success: true,
      message: 'Email verified successfully! You can now login.'
    });
    
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification error'
    });
  }
};


module.exports = {
    registerStudent,
    registerCompany,
    login,
    forgotPassword,
    resetPassword,
    verifyEmail,
    verifyResetToken,
    getMe
};