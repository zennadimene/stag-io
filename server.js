//DEPENDENCIES & IMPORTS
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http'); 
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer'); 
require('dotenv').config();

// Import routes
const studentRoutes = require('./routes/studentRoutes');
const companyApplicationsRoutes = require('./routes/companyApplications');
const adminNotificationsRoutes = require('./routes/adminNotifications');
const adminRoutes = require('./routes/adminRoutes');
const matchingRoutes = require('./routes/matchingRoutes');

// Import services
const notificationService = require('./services/notificationService');

// Import database & middleware
const db = require('./config/database');
const { protect } = require('./middleware/authMiddleware');

// Import auth controllers
const { 
    registerStudent, 
    registerCompany, 
    login, 
    forgotPassword,
    resetPassword,
    verifyEmail,
    verifyResetToken,
    getMe 
} = require('./controllers/authController');

// EXPRESS APP INITIALIZATION
const app = express();
const authenticate = protect;
const AUTO_VERIFY = true; 

// MIDDLEWARE
app.use(cors());
app.use(express.json());

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Protected route mounts
app.use('/api/student', protect, studentRoutes);  

// Routes registration
app.use('/', companyApplicationsRoutes);
app.use('/', adminRoutes);
app.use('/', adminNotificationsRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/matching', matchingRoutes);

// SOCKET.IO SETUP
const server = http.createServer(app);
const io = socketIo(server, {  
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
    }
});

global.io = io;  

notificationService.setSocketIO(io);

io.on('connection', (socket) => { 
    console.log('🔌 New client connected:', socket.id);

    
    const { userId, userType } = socket.handshake.query;
    
    if (userId) {
        notificationService.setActiveUser(userId, socket.id);
        console.log(`👤 User ${userId} (${userType}) connected`);
    }

    socket.on('disconnect', () => {
        notificationService.removeActiveUser(socket.id);
        console.log('👋 Client disconnected:', socket.id);
    });
});

// MULTER CONFIGURATION
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});
 
// Company upload configuration
const companyStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads/companies';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `company-${req.user.id}-${uniqueSuffix}${ext}`);
  }
});

const companyUpload = multer({ 
  storage: companyStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    cb(null, mimetype && extname);
  }
});

//BASIC ROUTES (Health, Test, Home)
app.get('/', (req, res) => {
    res.json({ 
        message: '🎉 STAG Platform Backend is running!',
        version: '3.0.0',
        database: 'MySQL Active',
        endpoints: {
            home: 'GET /',
            health: 'GET /health',
            register_student: 'POST /api/auth/register/student',
            register_company: 'POST /api/auth/register/company',
            login: 'POST /api/auth/login',
            test_db: 'GET /api/test-db',
            get_profile: 'GET /api/auth/me', 
            update_profile: 'PUT /api/student/profile'
        }
    });
});

app.get('/health', async (req, res) => {
    try {
        // Test database connection
        const [dbResult] = await db.execute('SELECT 1 + 1 AS result');
        
        res.json({ 
            status: '✅ healthy',
            timestamp: new Date().toISOString(),
            database: 'Connected ✓',
            uptime: process.uptime()
        });
    } catch (error) {
        res.json({ 
            status: '⚠️ partial',
            timestamp: new Date().toISOString(),
            database: 'Not connected ✗',
            error: error.message
        });
    }
});


app.get('/api/test-db', async (req, res) => {
    try {
        // Get counts from all tables
        const [usersCount] = await db.execute('SELECT COUNT(*) as count FROM users');
        const [studentsCount] = await db.execute('SELECT COUNT(*) as count FROM students');
        const [companiesCount] = await db.execute('SELECT COUNT(*) as count FROM companies');
        
        res.json({
            success: true,
            message: 'Database connection successful',
            counts: {
                users: usersCount[0].count,
                students: studentsCount[0].count,
                companies: companiesCount[0].count
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Database error',
            error: error.message
        });
    }
});


//AUTHENTICATION ROUTES

// Student Registration
app.post('/api/auth/register/student', async (req, res) => {
    console.log('\n🎓 Student Registration Request:', {
        email: req.body.university_email,
        time: new Date().toLocaleTimeString()
    });
    //connect with db
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();//if error occur stop
        //take all data entred by user
        const {
            first_name,
            last_name,
            university_email,
            phone,
            birth_date,
            university,
            specialization,
            year_of_study,
            student_id,
            skills,
            github_link,
            linkedin_link,
            password,
            training_type,
            preferred_wilaya,
            expected_start_date,
            social_security,        
            academic_supervisor 
        } = req.body;

        // Validate required data
        if (!university_email || !password || !first_name || !last_name || !university || !specialization || !year_of_study) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Please enter all required fields'
            });
        }

        // Validate email format
        const algerianUniversityRegex = /^p?[a-zA-Z]+\.[a-zA-Z]+@univ-[a-zA-Z]+[0-9]*\.dz$/;
        if (!algerianUniversityRegex.test(university_email)) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Invalid email format. Must be: prenom.nom@univ-constantine2.dz'
            });
        }

        // Check for duplicate email in db
        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE email = ?',
            [university_email]
        );
        
        if (existingUsers.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Email already registered'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // 1️⃣ Insert into USERS table with is_verified = 1
        const [userResult] = await connection.execute(
            `INSERT INTO users 
            (email, password, user_type, verification_token, is_verified, created_at) 
            VALUES (?, ?, ?, ?, ?, NOW())`,
            [university_email, hashedPassword, 'student', verificationToken, 0]
        );

        const userId = userResult.insertId;
        console.log('✅ User created with ID:', userId);

      //add in tab user
await connection.execute(
    `INSERT INTO students 
    (user_id, first_name, last_name, university_email, phone, 
     birth_date, university, specialization, year_of_study,
     student_id, skills, github_link, linkedin_link,
     training_type, preferred_wilaya, expected_start_date,
     social_security, academic_supervisor, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
        userId,
        first_name,
        last_name,
        university_email,
        phone || null,
        birth_date || null,
        university,
        specialization,
        year_of_study,
        student_id || null,
        skills ? JSON.stringify(skills) : null,
        github_link || null,
        linkedin_link || null,
        training_type || null,
        preferred_wilaya || null,
        expected_start_date || null,
        social_security || null,      
        academic_supervisor || null 
    ]
);

   
// ✅ إشعار الطالب الجديد (مثل الشركة)
try {
  const notificationMessage = `${first_name} ${last_name} (${university}) has registered and is waiting for approval.`;
  
  await connection.execute(
    `INSERT INTO admin_notifications 
     (type, title, message, student_id, data, created_at) 
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [
      'student_pending', 
      '👨‍🎓 New Student Registration Pending Approval', 
      notificationMessage, 
      userId,
      JSON.stringify({
        student_id: userId,
        student_name: `${first_name} ${last_name}`,
        student_email: university_email,
        university: university,
        specialization: specialization
      })
    ]
  );
  
  console.log('✅ Admin notification created for pending student:', userId);
} catch (notifError) {
  console.error('❌ Error creating admin notification:', notifError);
}
        
        console.log('✅ Student profile created for user ID:', userId);

        // Commit transaction
        await connection.commit();//save
        connection.release();

       res.status(201).json({
    success: true,
    user: {
        id: userId,
        email: university_email,
        user_type: 'student',
        is_verified: false  // account pending
    },
    redirectTo: '/student/pending' 
});

    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Student registration error:', error);
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                message: 'Email or student ID already exists'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Registration error',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Company Registration
app.post('/api/auth/register/company', async (req, res) => {
    console.log('\n🏢 Company Registration Request:', {
        email: req.body.company_email,
        time: new Date().toLocaleTimeString()
    });
    
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const {
            company_name,
            company_email,
            phone,
            website,
            trade_register,
            activity_sector,
            company_size,
            wilaya,
            address,
            contact_person,
            position,
            personal_email,
            description,
            password
        } = req.body;

        // Validate required data
        if (!company_email || !password || !company_name || !contact_person || !trade_register) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Please enter all required fields: email, password, company name, contact person, trade register'
            });
        }

        // Check for duplicate email
        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE email = ?',
            [company_email]
        );
        
        if (existingUsers.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Company email already registered'
            });
        }

        // Check for duplicate trade register
        const [existingCompanies] = await connection.execute(
            'SELECT id FROM companies WHERE trade_register = ?',
            [trade_register]
        );
        
        if (existingCompanies.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Trade register number already exists'
            });
        }

        // 🔐 Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');

        
       // 1️⃣ Insert into USERS table - COMPANY
const [userResult] = await connection.execute(
    `INSERT INTO users 
    (email, password, user_type, verification_token, is_verified, created_at) 
    VALUES (?, ?, ?, ?, ?, NOW())`,
    [company_email, hashedPassword, 'company', verificationToken, 0] 
);
        
        const userId = userResult.insertId;
        console.log('✅ Company user created with ID:', userId);

        // 2️⃣ Insert into COMPANIES table
        await connection.execute(
            `INSERT INTO companies 
            (user_id, company_name, company_email, phone, website,
             trade_register, activity_sector, company_size, wilaya,
             address, contact_person, position, personal_email, description,
             created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                userId,
                company_name,
                company_email,
                phone || null,
                website || null,
                trade_register,
                activity_sector || null,
                company_size || null,
                wilaya || null,
                address || null,
                contact_person,
                position || null,
                personal_email || null,
                description || null
            ]
        );
        
        console.log('✅ Company profile created for user ID:', userId);

        try {
            await connection.execute(
                `INSERT INTO admin_notifications 
                (type, title, message, data, created_at) 
                VALUES (?, ?, ?, ?, NOW())`,
                [
                    'company_registration',
                    '🏢 New Company Registration Pending Approval',
                    `${company_name} has registered and is waiting for verification.`,
                    JSON.stringify({
                        company_id: userId,
                        company_name,
                        company_email,
                        contact_person,
                        trade_register
                    })
                ]
            );
            console.log('✅ Admin notification sent');
        } catch (notifError) {
            console.error('❌ Failed to send admin notification:', notifError);
           
        }

        await connection.commit();
        connection.release();

        // Return success response
        res.status(201).json({
            success: true,
            message: 'Company registered successfully! Your account is pending approval. You will be notified once verified.',
            user: {
                id: userId,
                email: company_email,
                user_type: 'company',
                is_verified: false 
            },
            company: {
                company_name,
                contact_person,
                trade_register,
                activity_sector,
                wilaya
            }
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Company registration error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Registration error',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Check company status
app.post('/api/auth/check-company-status', async (req, res) => {
  try {
    const { email } = req.body;//verify if account of company is verified or no return t/f
    
    const [users] = await db.execute(
      'SELECT is_verified FROM users WHERE email = ? AND user_type = "company"',
      [email]
    );
    
    if (users.length === 0) {
      return res.json({
        success: false,
        message: 'Company not found'
      });
    }
    
    res.json({
      success: true,
      is_verified: users[0].is_verified === 1
    });
    
  } catch (error) {
    console.error('Error checking company status:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    console.log('\n🔐 Login Request:', {
        email: req.body.email,
        time: new Date().toLocaleTimeString()
    });
    
    try {
        const { email, password } = req.body;//recieve pass & email 

        // Validate data
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please enter email and password'
            });
        }

        // Find user in database
        const [users] = await db.execute(
            'SELECT id, email, password, user_type, is_verified FROM users WHERE email = ?',
            [email]
        );
        
        if (users.length === 0) {
            console.log('❌ User not found:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
        
        const user = users[0];

        // Verify password with bcrypt
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            console.log('❌ Password mismatch for:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

      if (!user.is_verified && user.user_type !== 'admin') {
    if (user.user_type === 'company') {
        return res.status(403).json({
            success: false,
            message: 'Your company account is pending approval. You will be notified once verified.',
            needs_verification: true,
            pending: true,
            redirectTo: '/company/pending'
        });
    } else if (user.user_type === 'student') {
        // ✅ تغيير هذا الجزء ليكون مثل الشركات
        return res.status(403).json({
            success: false,
            message: 'Your student account is pending approval by the administration. You will be notified once verified.',
            needs_verification: true,
            pending: true,
            redirectTo: '/student/pending'  // ← إضافة صفحة pending للطلاب
        });
    }
}

        // Get profile data based on user type
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
        } else if (user.user_type === 'admin') {
            profile = { name: 'System Administrator' };
        }

        // Create JWT token
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                user_type: user.user_type
            },
            process.env.JWT_SECRET || 'default_jwt_secret_12345',
            { expiresIn: '7d' }
        );

        console.log('✅ Login successful:', {
            email: user.email,
            user_type: user.user_type,
            id: user.id
        });

        // Dashboard routes
        const dashboardRoutes = {
            'student': '/student/dashboard',
            'company': '/company/dashboard',
            'admin': '/admin/dashboard'
        };

        // Send response
        res.json({
            success: true,
            token: token,
            user: {
                id: user.id,
                email: user.email,
                user_type: user.user_type,
                is_verified: user.is_verified
            },
            profile: profile,
            redirectTo: dashboardRoutes[user.user_type]
        });

    } catch (error) {
        console.error('🔥 Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});


app.post('/api/auth/check-student-status', async (req, res) => {
  try {
    const { email } = req.body;
    
    const [users] = await db.execute(
      'SELECT is_verified FROM users WHERE email = ? AND user_type = "student"',
      [email]
    );
    
    if (users.length === 0) {
      return res.json({
        success: false,
        message: 'Student not found'
      });
    }
    
    res.json({
      success: true,
      is_verified: users[0].is_verified === 1
    });
    
  } catch (error) {
    console.error('Error checking student status:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});


// Email verification
app.get('/api/auth/verify-email/:token', async (req, res) => {
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
});

// Admin verify user
app.post('/api/admin/verify-user/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
        const [result] = await db.execute(
            'UPDATE users SET is_verified = TRUE WHERE id = ?',
            [userId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        res.json({
            success: true,
            message: 'User verified successfully'
        });
    } catch (error) {
        console.error('Admin verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Verification error'
        });
    }
});

// Get current user profile
app.get('/api/auth/me', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.user_type;
        
        console.log('🔍 Fetching profile for:', { userId, userType });
        
        if (userType === 'student') {
            const [students] = await db.execute(
                `SELECT 
                    first_name, 
                    last_name, 
                    birth_date,
                    university, 
                    specialization, 
                    year_of_study,
                    wilaya,
                    phone,
                    bio,
                    skills,
                    soft_skills,
                    github_link,
                    linkedin_link,
                    profile_image_url, 
                    social_security,       
                    academic_supervisor,
                    experiences,
                    created_at
                FROM students 
                WHERE user_id = ?`,
                [userId]
            );
            
            if (students.length === 0) {
                return res.json({
                    success: true,
                    profile: {
                        first_name: '',
                        last_name: '',
                        birth_date: '',
                        university: '',
                        specialization: '',
                        year_of_study: '',
                        wilaya: '',
                        phone: '',
                        bio: '',
                        skills: [],
                        soft_skills: [],
                        experiences: [],  // ✅ ADD THIS
                        github_url: '',
                        linkedin_url: '',
                        profile_image_url: '',
                        social_security: '',        
                        academic_supervisor: '', 
                        created_at: null
                    }
                });
            }
            
            const student = students[0];
            
            // ✅ Parse skills
            let skills = [];
            if (student.skills) {
                try {
                    skills = JSON.parse(student.skills);
                } catch (e) {
                    if (typeof student.skills === 'string') {
                        skills = student.skills.split(',').map(s => s.trim()).filter(s => s);
                    }
                }
            }
            
            // ✅ Parse soft_skills (ADD THIS)
            let soft_skills = [];
            if (student.soft_skills) {
                try {
                    soft_skills = typeof student.soft_skills === 'string' 
                        ? JSON.parse(student.soft_skills) 
                        : student.soft_skills;
                } catch (e) {
                    if (typeof student.soft_skills === 'string') {
                        soft_skills = student.soft_skills.split(',').map(s => s.trim()).filter(s => s);
                    }
                }
            }
            
            // ✅ Parse experiences (ADD THIS)
            let experiences = [];
            if (student.experiences) {
                try {
                    experiences = typeof student.experiences === 'string' 
                        ? JSON.parse(student.experiences) 
                        : student.experiences;
                } catch (e) {
                    experiences = [];
                }
            }
            
            console.log('📤 Sending profile data to frontend:', {
                first_name: student.first_name,
                last_name: student.last_name,
                skills_count: skills.length,
                soft_skills_count: soft_skills.length,  // ✅ ADD THIS
                experiences_count: experiences.length   // ✅ ADD THIS
            });

            res.json({
                success: true,
                profile: {
                    first_name: student.first_name || '',
                    last_name: student.last_name || '',
                    birth_date: student.birth_date || '',
                    university: student.university || '',
                    specialization: student.specialization || '',
                    year_of_study: student.year_of_study || '',
                    wilaya: student.wilaya || '',
                    phone: student.phone || '',
                    bio: student.bio || '',
                    skills: skills,
                    soft_skills: soft_skills,           // ✅ ADD THIS
                    experiences: experiences,            // ✅ ADD THIS
                    github_url: student.github_link || '',
                    portfolio_url: student.linkedin_link || '',
                    profile_image_url: student.profile_image_url || '',
                    social_security: student.social_security || '',        
                    academic_supervisor: student.academic_supervisor || '',
                    created_at: student.created_at
                }
            });
            
         } else if (userType === 'company') {
            // ✅✅✅ أضف هذا الكود للشركة ✅✅✅
            console.log('🏢 Fetching company profile for ID:', userId);
            
            const [companies] = await db.execute(
                `SELECT 
                    c.user_id as id,
                    c.company_name,
                    c.company_email,
                    c.phone,
                    c.website,
                    c.trade_register,
                    c.activity_sector,
                    c.company_size,
                    c.wilaya,
                    c.address,
                    c.contact_person,
                    c.position,
                    c.personal_email,
                    c.description,
                    c.logo_url,
                    c.cover_image_url,
                    c.social_media,
                    c.founded_year,
                    c.tax_id,
                    c.average_rating,
                    c.created_at,
                    u.email,
                    u.is_verified,
                    u.is_suspended
                FROM companies c
                JOIN users u ON c.user_id = u.id
                WHERE c.user_id = ?`,
                [userId]
            );
            
            if (companies.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Company profile not found'
                });
            }
            
            const company = companies[0];
            
            // ✅ Parse social_media من JSON
            let social_media = {};
            if (company.social_media) {
                try {
                    social_media = typeof company.social_media === 'string' 
                        ? JSON.parse(company.social_media) 
                        : company.social_media;
                } catch (e) {
                    social_media = {};
                }
            }
            
            console.log('📤 Sending company profile:', {
                company_name: company.company_name,
                email: company.email,
                is_verified: company.is_verified,
                is_suspended: company.is_suspended
            });
            
            res.json({
                success: true,
                profile: {
                    id: company.id,
                    company_name: company.company_name,
                    company_email: company.company_email,
                    email: company.email,
                    phone: company.phone,
                    website: company.website,
                    trade_register: company.trade_register,
                    activity_sector: company.activity_sector,
                    company_size: company.company_size,
                    wilaya: company.wilaya,
                    address: company.address,
                    contact_person: company.contact_person,
                    position: company.position,
                    personal_email: company.personal_email,
                    description: company.description,
                    logo_url: company.logo_url,
                    cover_image_url: company.cover_image_url,
                    social_media: social_media,
                    founded_year: company.founded_year,
                    tax_id: company.tax_id,
                    average_rating: company.average_rating,
                    created_at: company.created_at,
                    is_verified: company.is_verified,
                    is_suspended: company.is_suspended
                }
            });
            
        } else {
            res.status(400).json({
                success: false,
                message: 'Invalid user type'
            });
        }
        
    } catch (error) {
        console.error('🔥 Error fetching profile:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading profile'
        });
    }
});


// Email verification
app.get('/api/auth/verify-email/:token', verifyEmail);

// Password reset routes
app.post('/api/auth/forgot-password', forgotPassword);
app.get('/api/auth/verify-reset-token/:token', verifyResetToken);
app.post('/api/auth/reset-password/:token', resetPassword);

// Debug route
app.get('/api/debug/password/:userId', async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, email, password, updated_at FROM users WHERE id = ?',
      [req.params.userId]
    );
    
    if (users.length === 0) {
      return res.json({ error: 'User not found' });
    }
    
    res.json({
      id: users[0].id,
      email: users[0].email,
      password_preview: users[0].password.substring(0, 30) + '...',
      updated_at: users[0].updated_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// 👨‍🎓 STUDENT ROUTES


// ✅ قبول الطالب من قبل الأدمن
app.put('/api/admin/students/:studentId/approve', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // Verify user is admin to do this act
        if (req.user.user_type !== 'admin') {
            await connection.rollback();
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        const studentId = req.params.studentId;

        // Check if student exists
        const [students] = await connection.execute(
            `SELECT u.id, u.email, s.first_name, s.last_name 
             FROM users u
             JOIN students s ON u.id = s.user_id
             WHERE u.id = ? AND u.user_type = 'student'`,
            [studentId]
        );

        if (students.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        const student = students[0];

        // Approve student (set is_verified = 1)
        await connection.execute(
            'UPDATE users SET is_verified = 1 WHERE id = ?',
            [studentId]
        );


        // Update admin notification
        await connection.execute(
            `UPDATE admin_notifications 
             SET is_read = 1, data = JSON_SET(IFNULL(data, '{}'), '$.approved', TRUE)
             WHERE JSON_EXTRACT(data, '$.student_id') = ?`,
            [studentId]
        );

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: `Student "${student.first_name} ${student.last_name}" has been approved successfully`
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Error approving student:', error);
        res.status(500).json({
            success: false,
            message: 'Error approving student'
        });
    }
});

// ✅ رفض الطالب من قبل الأدمن
app.delete('/api/admin/students/:studentId/reject', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // Verify user is admin
        if (req.user.user_type !== 'admin') {
            await connection.rollback();
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        const studentId = req.params.studentId;
        const { reason } = req.body;

        // Get student info before deletion
        const [students] = await connection.execute(
            `SELECT u.email, s.first_name, s.last_name 
             FROM users u
             JOIN students s ON u.id = s.user_id
             WHERE u.id = ?`,
            [studentId]
        );

        if (students.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        const student = students[0];

        // Delete student (cascade will delete from users table)
        await connection.execute(
            'DELETE FROM users WHERE id = ?',
            [studentId]
        );

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: `Student "${student.first_name} ${student.last_name}" has been rejected and removed`
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Error rejecting student:', error);
        res.status(500).json({
            success: false,
            message: 'Error rejecting student'
        });
    }
});

// ✅ جلب الطلاب المنتظرين للموافقة
app.get('/api/admin/pending-students', protect, async (req, res) => {
    try {
        // Verify user is admin
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        // Get all students with pending verification
        const [students] = await db.execute(
            `SELECT u.id, u.email, u.created_at, 
                    s.first_name, s.last_name, s.university, 
                    s.specialization, s.year_of_study, s.phone
             FROM users u
             JOIN students s ON u.id = s.user_id
             WHERE u.user_type = 'student' AND u.is_verified = 0
             ORDER BY u.created_at DESC`
        );

        res.json({
            success: true,
            students: students
        });

    } catch (error) {
        console.error('🔥 Error fetching pending students:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching pending students'
        });
    }
});


// ✅ تعليق الطالب (Suspend Student)
app.put('/api/admin/students/:studentId/suspend', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Admin only.' 
            });
        }

        const studentId = req.params.studentId;
        
        // Check if student exists
        const [students] = await db.execute(
            'SELECT id FROM users WHERE id = ? AND user_type = "student"',
            [studentId]
        );
        
        if (students.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found' 
            });
        }
        
        // Suspend student
        const [result] = await db.execute(
            'UPDATE users SET is_suspended = 1 WHERE id = ? AND user_type = "student"',
            [studentId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found' 
            });
        }
        
        console.log(`✅ Student ${studentId} suspended successfully`);
        
        res.json({ 
            success: true, 
            message: 'Student suspended successfully' 
        });
        
    } catch (error) {
        console.error('🔥 Error suspending student:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error suspending student' 
        });
    }
});

// ✅ تفعيل الطالب (Activate/Unsuspend Student)
app.put('/api/admin/students/:studentId/unsuspend', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Admin only.' 
            });
        }

        const studentId = req.params.studentId;
        
        // Check if student exists
        const [students] = await db.execute(
            'SELECT id FROM users WHERE id = ? AND user_type = "student"',
            [studentId]
        );
        
        if (students.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found' 
            });
        }
        
        // Activate student (remove suspension)
        const [result] = await db.execute(
            'UPDATE users SET is_suspended = 0 WHERE id = ? AND user_type = "student"',
            [studentId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found' 
            });
        }
        
        console.log(`✅ Student ${studentId} activated successfully`);
        
        // Send notification to student (optional)
        await db.execute(
            `INSERT INTO notifications 
             (user_id, type, title, message, created_at) 
             VALUES (?, 'activation', '✅ Your Account Has Been Activated', 
             'Your account has been reactivated. You can now log in and continue using the platform.', NOW())`,
            [studentId]
        );
        
        res.json({ 
            success: true, 
            message: 'Student activated successfully' 
        });
        
    } catch (error) {
        console.error('🔥 Error activating student:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error activating student' 
        });
    }
});

// ✅ حذف الطالب (Delete Student)
app.delete('/api/admin/students/:studentId', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // Verify user is admin
        if (req.user.user_type !== 'admin') {
            await connection.rollback();
            connection.release();
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Admin only.' 
            });
        }

        const studentId = req.params.studentId;

        // Check if student exists
        const [students] = await connection.execute(
            'SELECT id, email FROM users WHERE id = ? AND user_type = "student"',
            [studentId]
        );

        if (students.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ 
                success: false, 
                message: 'Student not found' 
            });
        }

        // Delete student (cascade will delete from students table and all related data)
        const [result] = await connection.execute(
            'DELETE FROM users WHERE id = ?',
            [studentId]
        );

        console.log(`✅ Student ${studentId} deleted successfully`);

        await connection.commit();
        connection.release();

        res.json({ 
            success: true, 
            message: 'Student deleted successfully' 
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Error deleting student:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting student: ' + error.message 
        });
    }
});

// ✅ جلب جميع الطلاب (للوحة التحكم)
app.get('/api/admin/students', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Admin only.' 
            });
        }

        const [students] = await db.execute(`
            SELECT 
                u.id,
                u.email,
                u.is_verified,
                u.is_suspended,
                u.created_at,
                s.first_name,
                s.last_name,
                s.university,
                s.specialization,
                s.year_of_study,
                s.wilaya,
                s.phone,
                s.bio,
                s.skills,
                s.profile_image_url,
                (SELECT COUNT(*) FROM student_internships WHERE student_id = u.id) as applications_count
            FROM users u
            JOIN students s ON u.id = s.user_id
            WHERE u.user_type = 'student'
            ORDER BY u.created_at DESC
        `);

        res.json({ 
            success: true, 
            students
        });

    } catch (error) {
        console.error('🔥 Error fetching students:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching students' 
        });
    }
});


// Profile Management

app.delete('/api/student/profile/image', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        console.log('🗑️ DELETE PROFILE IMAGE - Route called');
        console.log('User ID:', req.user.id);
        
        await connection.beginTransaction();
        
        // Get current profile image URL
        const [students] = await connection.execute(
            'SELECT profile_image_url FROM students WHERE user_id = ?',
            [req.user.id]
        );
        
        if (students.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ 
                success: false, 
                message: 'Student profile not found' 
            });
        }
        
        const currentImageUrl = students[0].profile_image_url;
        console.log('Current image URL:', currentImageUrl);
        
        if (currentImageUrl) {
            // Delete file from server
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, currentImageUrl);
            console.log('Looking for file at:', filePath);
            
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('✅ File deleted from server');
            } else {
                console.log('⚠️ File not found on disk:', filePath);
            }
        }
        
        // Update database - set profile_image_url to NULL
        const [updateResult] = await connection.execute(
            'UPDATE students SET profile_image_url = NULL, updated_at = NOW() WHERE user_id = ?',
            [req.user.id]
        );
        
        console.log('Database update affected rows:', updateResult.affectedRows);
        
        // Also update localStorage info (return updated user data)
        const [updatedStudent] = await connection.execute(
            'SELECT profile_image_url FROM students WHERE user_id = ?',
            [req.user.id]
        );
        
        await connection.commit();
        connection.release();
        
        res.json({ 
            success: true, 
            message: 'Profile image deleted successfully',
            profile_image_url: null
        });
        
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('❌ Error deleting profile image:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting profile image: ' + error.message 
        });
    }
});


// Activities & Stats
app.get('/api/student/activities', protect, async (req, res) => {
  try {
    const studentId = req.user.id;
    
    console.log('📋 Fetching applications for student:', studentId);
    
    const [applications] = await db.execute(`
      SELECT 
        MIN(si.id) as id,
        si.status,
        i.title as internship_title,
        c.company_name,
        MIN(si.applied_at) as applied_date
      FROM student_internships si
      JOIN internships i ON si.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE si.student_id = ?
      GROUP BY si.internship_id, si.status, i.title, c.company_name
      ORDER BY applied_date DESC
    `, [studentId]);
    
    console.log('✅ Found applications:', applications.length);
    

    const [notifications] = await db.execute(`
      SELECT 
        'notification' as type,
        id,
        title,
        message,
        created_at
      FROM notifications 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [studentId]);
    
    console.log('📨 Found notifications:', notifications.length);
    
  
    const [agreements] = await db.execute(`
      SELECT 
        'agreement' as type,
        id,
        internship_title,
        company_name,
        status,
        created_at
      FROM agreements 
      WHERE student_id = ?
      ORDER BY created_at DESC
    `, [studentId]);
    
    console.log('📄 Found agreements:', agreements.length);
    
  
    const stats = {
      applications: applications.length,
      notifications: notifications.length,
      agreements: agreements.length,
      total: applications.length + notifications.length + agreements.length
    };
    
    console.log('📊 Final stats:', stats);
    

    const allActivities = [
      ...applications.map(a => ({ ...a, type: 'application' })),
      ...notifications,
      ...agreements
    ];
    

    allActivities.sort((a, b) => new Date(b.created_at || b.applied_date) - new Date(a.created_at || a.applied_date));
    
    res.json({
      success: true,
      stats: stats,
      activities: allActivities
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message,
      activities: [],
      stats: { total: 0, applications: 0, notifications: 0, agreements: 0 }
    });
  }
});



app.get('/api/student/success-stats', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Students only.' 
      });
    }

    const studentId = req.user.id;
    
    console.log('🔍 Fetching success stats for student:', studentId);
    
    const [completedAgreements] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM agreements 
      WHERE student_id = ? AND status = 'completed'
    `, [studentId]);
    console.log('✅ Completed agreements:', completedAgreements[0].count);
    
    const [completedInternships] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM student_internships si
      WHERE si.student_id = ? AND si.status = 'accepted' 
        AND (si.is_validated = 1 OR si.is_validated IS TRUE)
    `, [studentId]);
    console.log('✅ Completed internships:', completedInternships[0].count);
    
    const [certificates] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM documents d
      WHERE d.agreement_id IN (
        SELECT id FROM agreements WHERE student_id = ?
      ) AND d.document_type = 'certificate'
    `, [studentId]);
    console.log('✅ Certificates from documents table:', certificates[0].count);
    
    const [tableCheck] = await db.execute(`
      SHOW TABLES LIKE 'documents'
    `);
    console.log('📊 Documents table exists:', tableCheck.length > 0);
    
    if (tableCheck.length > 0) {
      const [allCertificates] = await db.execute(`
        SELECT d.id, d.agreement_id, d.document_type, d.file_name 
        FROM documents d
        WHERE d.document_type = 'certificate'
      `);
      console.log('📊 All certificates in DB:', allCertificates);
    }
    

    const [totalHours] = await db.execute(`
      SELECT SUM(i.duration * 160) as total_hours 
      FROM internships i
      JOIN agreements a ON a.internship_id = i.id
      WHERE a.student_id = ? AND a.status = 'completed'
    `, [studentId]);
    console.log('✅ Total hours:', totalHours[0].total_hours);
    
  
    const [totalApplications] = await db.execute(`
      SELECT COUNT(*) as count FROM student_internships WHERE student_id = ?
    `, [studentId]);
    
    const [acceptedCount] = await db.execute(`
      SELECT COUNT(*) as count FROM student_internships 
      WHERE student_id = ? AND status = 'accepted' AND is_validated = 1
    `, [studentId]);
    
    const successRate = totalApplications[0].count > 0 
      ? Math.round((acceptedCount[0].count / totalApplications[0].count) * 100) 
      : 0;
    
    const stats = {
      completedAgreements: completedAgreements[0].count || 0,
      completedInternships: completedInternships[0].count || 0,
      certificatesReceived: certificates[0].count || 0,
      totalHours: totalHours[0].total_hours || 0,
      successRate: successRate
    };
    
    console.log('📊 Final stats sent to frontend:', stats);
    
    res.json({
      success: true,
      stats: stats
    });
    
  } catch (error) {
    console.error('🔥 Error fetching success stats:', error);
    res.json({
      success: true,
      stats: {
        completedAgreements: 0,
        completedInternships: 0,
        certificatesReceived: 0,
        totalHours: 0,
        successRate: 0
      }
    });
  }
});

// Applications
//display list of all internship apply on it and details
app.get('/api/student/applications', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log('📋 Fetching applications for user:', userId);
    
    const [applications] = await db.execute(`
      SELECT 
        MIN(si.id) as id,
        si.meeting_link,
        si.student_id,
        si.internship_id,
        si.status,
        MIN(si.applied_at) as applied_date,
        si.reviewed_at,
        si.feedback,
        si.interview_date,
        si.interview_time,
        si.interview_mode,
        ag.id as agreement_id,
        i.title as internship_title,
        i.type as internship_type,
        i.location as internship_location,
        i.duration,
        i.stipend,
        c.company_name,
        c.company_email,
        c.wilaya as company_location
      FROM student_internships si
      JOIN internships i ON si.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      LEFT JOIN agreements ag ON si.internship_id = ag.internship_id AND ag.student_id = si.student_id
      WHERE si.student_id = ?
      GROUP BY si.internship_id
      ORDER BY applied_date DESC
    `, [userId]);
    
    console.log(`✅ Found ${applications.length} applications from database`);
    console.log('📊 Application IDs:', applications.map(a => a.id));
    
    res.json({ 
      success: true, 
      applications 
    });
    
  } catch (error) {
    console.error('🔥 Error fetching applications:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching applications',
      error: error.message 
    });
  }
});

// apply on offer after 7 conditions
app.post('/api/student/applications', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const userId = req.user.id;
        const userType = req.user.user_type;
        const { internship_id } = req.body;
        
        // Verify user is a student
        if (userType !== 'student') {
            await connection.rollback();
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Access denied. Students only.'
            });
        }
        
        // Validate input
        if (!internship_id) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Internship ID is required'
            });
        }
        
        // Check if internship exists and is active
        const [internships] = await connection.execute(
            'SELECT id, deadline, company_id FROM internships WHERE id = ? AND status = "active"',
            [internship_id]
        );
        
        if (internships.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Internship not found or not active'
            });
        }
        
        const internship = internships[0];
        
        // Check if deadline has passed
        if (internship.deadline && new Date(internship.deadline) < new Date()) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Application deadline has passed'
            });
        }
        
        // Check if student already applied
        const [existingApplications] = await connection.execute(
            'SELECT id FROM student_internships WHERE student_id = ? AND internship_id = ?',
            [userId, internship_id]
        );
        
        if (existingApplications.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'You have already applied to this internship'
            });
        }
        
        // Check if student has completed profile
        const [studentProfile] = await connection.execute(
            'SELECT first_name, last_name, university FROM students WHERE user_id = ?',
            [userId]
        );
        
        if (studentProfile.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Please complete your profile before applying'
            });
        }
        
        const student = studentProfile[0];
        
        // Create application in student_internships table
        const [applicationResult] = await connection.execute(
            `INSERT INTO student_internships 
            (student_id, internship_id, status, applied_at) 
            VALUES (?, ?, 'pending', NOW())`,
            [userId, internship_id]
        );
        
        // ✅ CORRECT: Create notification for company in company_notifications table
        if (internship.company_id) {
            await connection.execute(
                `INSERT INTO company_notifications 
                 (company_id, type, title, message, application_id, is_read, created_at) 
                 VALUES (?, ?, ?, ?, ?, 0, NOW())`,
                [
                    internship.company_id,
                    'application',
                    '📬 New Application Received',
                    `${student.first_name} ${student.last_name} from ${student.university} has applied to your internship.`,
                    applicationResult.insertId
                ]
            );
            console.log('✅ Company notification created for application:', applicationResult.insertId);
        }
        
        // Commit transaction
        await connection.commit();
        connection.release();
        
        console.log('✅ Application submitted:', {
            student_id: userId,
            internship_id: internship_id,
            application_id: applicationResult.insertId
        });
        
        res.json({
            success: true,
            message: 'Application submitted successfully!',
            application_id: applicationResult.insertId
        });
        
    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Error submitting application:', error);
        res.status(500).json({
            success: false,
            message: 'Error submitting application',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});


app.delete('/api/student/applications/:applicationId', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.user_type;
        const applicationId = req.params.applicationId;
        
        // Verify user is a student
        if (userType !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Students only.'
            });
        }
        
        // Check if application exists and belongs to student
        const [applications] = await db.execute(
            'SELECT * FROM student_internships WHERE id = ? AND student_id = ?',
            [applicationId, userId]
        );
        
        if (applications.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Application not found'
            });
        }
        
        const application = applications[0];
        
        // Check if application can be withdrawn (only pending or reviewed)
        if (!['pending', 'reviewed'].includes(application.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot withdraw application in "${application.status}" status`
            });
        }
        
        // Delete the application
        await db.execute(
            'DELETE FROM student_internships WHERE id = ?',
            [applicationId]
        );
        
        // Create notification for company
        const [internshipInfo] = await db.execute(
            'SELECT company_id, title FROM internships WHERE id = ?',
            [application.internship_id]
        );
        
        if (internshipInfo.length > 0) {
            const companyId = internshipInfo[0].company_id;
            const internshipTitle = internshipInfo[0].title;
            
            // Get student name for notification
            const [studentInfo] = await db.execute(
                'SELECT first_name, last_name FROM students WHERE user_id = ?',
                [userId]
            );
            
            if (studentInfo.length > 0) {
                const studentName = `${studentInfo[0].first_name} ${studentInfo[0].last_name}`;
                
                await db.execute(
                    `INSERT INTO company_notifications 
                    (company_id, type, title, message, is_read, created_at) 
                    VALUES (?, ?, ?, ?, 0, NOW())`,
                    [
                        companyId,
                        'rejection',
                        '📋 Application Withdrawn',
                        `${studentName} has withdrawn their application for "${internshipTitle}".`
                    ]
                );
                console.log('✅ Company notification created for withdrawal');
            }
        }
        
        console.log('✅ Application withdrawn:', {
            application_id: applicationId,
            student_id: userId
        });
        
        res.json({
            success: true,
            message: 'Application withdrawn successfully'
        });
        
    } catch (error) {
        console.error('🔥 Error withdrawing application:', error);
        res.status(500).json({
            success: false,
            message: 'Error withdrawing application',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});


app.put('/api/student/applications/:id/accept', protect, async (req, res) => {
  try {
    const studentId = req.user.id;
    const applicationId = req.params.id;
    
    console.log(`✅ Accepting offer for application ${applicationId} by student ${studentId}`);
    
    // التحقق من أن التطبيق موجود وخاص بهذا الطالب
    const [applications] = await db.execute(
      'SELECT si.*, i.title as internship_title FROM student_internships si JOIN internships i ON si.internship_id = i.id WHERE si.id = ? AND si.student_id = ?',
      [applicationId, studentId]
    );
    
    if (applications.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Application not found' 
      });
    }
    
    const application = applications[0];
    
    // تحديث حالة التطبيق إلى accepted
    await db.execute(
      'UPDATE student_internships SET status = "accepted", updated_at = NOW() WHERE id = ?',
      [applicationId]
    );
    
    // إنشاء إشعار للطالب
    await db.execute(
      `INSERT INTO notifications (user_id, title, message, type, created_at) 
       VALUES (?, ?, ?, 'acceptance', NOW())`,
      [
        studentId,
        'Offer Accepted',
        `You have successfully accepted the offer for ${application.internship_title}.`
      ]
    );
    
    res.json({ 
      success: true, 
      message: 'Offer accepted successfully' 
    });
    
  } catch (error) {
    console.error('🔥 Error accepting offer:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error accepting offer',
      error: error.message 
    });
  }
});


// Saved Internships
app.get('/api/student/saved-internships', protect, async (req, res) => {
  try {
    // Verify user is student
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Student only.' 
      });
    }

    // Check if saved_internships table exists
    const [tables] = await db.execute(
      "SHOW TABLES LIKE 'saved_internships'"
    );
    
    if (tables.length === 0) {
      // Create table if not exists
      await db.execute(`
        CREATE TABLE IF NOT EXISTS saved_internships (
          id INT AUTO_INCREMENT PRIMARY KEY,
          student_id INT NOT NULL,
          internship_id INT NOT NULL,
          saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          notes TEXT,
          FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (internship_id) REFERENCES internships(id) ON DELETE CASCADE,
          UNIQUE KEY unique_save (student_id, internship_id)
        )
      `);
    }

    // الكود المعدل (بدون si.notes)
const [saved] = await db.execute(
    `SELECT 
        si.id,
        si.saved_at,
        i.id as internship_id,
        i.title as internship_title,
        i.type as internship_type,
        i.location,
        i.duration,
        i.stipend,
        i.description,
        i.deadline as deadline,
        i.required_skills,
        c.company_name,
        c.logo_url as company_logo,  
        c.wilaya as company_location
    FROM saved_internships si
    JOIN internships i ON si.internship_id = i.id
    JOIN companies c ON i.company_id = c.user_id
    WHERE si.student_id = ?
    ORDER BY si.saved_at DESC`,
    [req.user.id]
);


    // ✅ أضف هذا السطر لعرض البيانات في CMD
    console.log('\n📋 SAVED INTERNSHIPS FOR STUDENT', req.user.id);
    console.log('==========================================');
    saved.forEach((item, index) => {
      console.log(`\n${index + 1}. ID: ${item.id}`);
      console.log(`   Title: ${item.internship_title}`);
      console.log(`   Type: ${item.internship_type || 'N/A'}`);
      console.log(`   Location: ${item.location || 'N/A'}`);
      console.log(`   Company: ${item.company_name}`);
      console.log(`   Saved at: ${item.saved_at}`);
      console.log(`   Deadline: ${item.deadline || 'No deadline'}`);
     console.log(`   Is Remote: ${(item.internship_type || '').toLowerCase() === 'remote' ? '✅ YES' : 
                              (item.location || '').toLowerCase() === 'remote' ? '✅ YES' : '❌ NO'}`);
    });
    console.log('\n==========================================');
    console.log(`📊 TOTAL: ${saved.length} saved internships\n`);


    // Format the response
    const formatted = saved.map(item => ({
      id: item.id,
      internship_id: item.internship_id,
      internship_title: item.internship_title,
      internship_type: item.internship_type || 'full-time', 
      company_name: item.company_name || 'Unknown Company',
      company_logo: item.company_logo,
      location: item.location,
      duration: item.duration || 3,
      stipend: item.stipend,
      deadline: item.deadline,
      description: item.description,
      required_skills: item.required_skills ? JSON.parse(item.required_skills) : [],
      saved_at: item.saved_at,
      notes: item.notes
    }));

    res.json({
      success: true,
      savedInternships: formatted
    });

  } catch (error) {
    console.error('🔥 Error fetching saved internships:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching saved internships',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


app.post('/api/student/saved-internships/:internshipId', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    // Verify user is student
    if (req.user.user_type !== 'student') {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Student only.' 
      });
    }

    const { internshipId } = req.params;

    // Check if internship exists
    const [internships] = await connection.execute(
      'SELECT id FROM internships WHERE id = ? AND status = "active"',
      [internshipId]
    );

    if (internships.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Internship not found' 
      });
    }

    // Check if already saved
    const [existing] = await connection.execute(
      'SELECT id FROM saved_internships WHERE student_id = ? AND internship_id = ?',
      [req.user.id, internshipId]
    );

    if (existing.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Internship already saved' 
      });
    }

    // Save internship
    const [result] = await connection.execute(
      `INSERT INTO saved_internships 
      (student_id, internship_id, saved_at) 
      VALUES (?, ?, NOW())`,
      [req.user.id, internshipId]
    );

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Internship saved successfully',
      saved_id: result.insertId
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('🔥 Error saving internship:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error saving internship',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


app.delete('/api/student/saved-internships/:internshipId', protect, async (req, res) => {
  try {
    // Verify user is student
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Student only.' 
      });
    }

    const { internshipId } = req.params;

    await db.execute(
      'DELETE FROM saved_internships WHERE student_id = ? AND internship_id = ?',
      [req.user.id, internshipId]
    );

    res.json({
      success: true,
      message: 'Internship removed from saved'
    });

  } catch (error) {
    console.error('🔥 Error removing saved internship:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error removing saved internship',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


app.delete('/api/student/saved-internships', protect, async (req, res) => {
  try {
    // Verify user is student
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Student only.' 
      });
    }

    await db.execute(
      'DELETE FROM saved_internships WHERE student_id = ?',
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'All saved internships removed'
    });

  } catch (error) {
    console.error('🔥 Error removing all saved internships:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error removing all saved internships',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


app.get('/api/student/saved-internships/check/:internshipId', protect, async (req, res) => {
  try {
    // Verify user is student
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Student only.' 
      });
    }

    const { internshipId } = req.params;

    const [saved] = await db.execute(
      'SELECT id FROM saved_internships WHERE student_id = ? AND internship_id = ?',
      [req.user.id, internshipId]
    );

    res.json({
      success: true,
      isSaved: saved.length > 0,
      saved_id: saved[0]?.id
    });

  } catch (error) {
    console.error('🔥 Error checking saved status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error checking saved status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


app.put('/api/student/saved-internships/:internshipId/notes', protect, async (req, res) => {
  try {
    // Verify user is student
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Student only.' 
      });
    }

    const { internshipId } = req.params;
    const { notes } = req.body;

    const [result] = await db.execute(
      'UPDATE saved_internships SET notes = ? WHERE student_id = ? AND internship_id = ?',
      [notes, req.user.id, internshipId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Saved internship not found' 
      });
    }

    res.json({
      success: true,
      message: 'Notes added successfully'
    });

  } catch (error) {
    console.error('🔥 Error adding notes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error adding notes',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


app.get('/api/student/saved-internships/recommendations', protect, async (req, res) => {
  try {
    // Verify user is student
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Student only.' 
      });
    }

    // Get user's saved internships skills
    const [saved] = await db.execute(
      `SELECT i.required_skills, i.location, i.type 
       FROM saved_internships si
       JOIN internships i ON si.internship_id = i.id
       WHERE si.student_id = ?`,
      [req.user.id]
    );

    if (saved.length === 0) {
      return res.json({
        success: true,
        recommendations: []
      });
    }

    // Extract skills and locations
    const skills = new Set();
    const locations = new Set();
    const types = new Set();

    saved.forEach(item => {
      if (item.required_skills) {
        try {
          JSON.parse(item.required_skills).forEach(skill => skills.add(skill));
        } catch (e) {}
      }
      if (item.location) locations.add(item.location);
      if (item.type) types.add(item.type);
    });

    console.log('📊 Skills from saved:', Array.from(skills));
    console.log('📊 Locations from saved:', Array.from(locations));
    console.log('📊 Types from saved:', Array.from(types));

    // Get saved IDs to exclude
    const [savedIds] = await db.execute(
      'SELECT internship_id FROM saved_internships WHERE student_id = ?',
      [req.user.id]
    );
    const excludedIds = savedIds.map(s => s.internship_id);
    
    // ✅ إذا لم تكن هناك تدريبات محفوظة، أرجع مصفوفة فارغة
    if (excludedIds.length === 0) {
      return res.json({ success: true, recommendations: [] });
    }

    // ✅ بناء شروط JSON_CONTAINS لكل مهارة باستخدام IN
    const skillsArray = Array.from(skills);
    
    // ✅ استخدام JSON_EXTRACT بدلاً من JSON_CONTAINS (أكثر توافقاً)
    let sql = `
      SELECT 
        i.id,
        i.title,
        i.type,
        i.location,
        i.stipend,
        i.required_skills,
        c.company_name
      FROM internships i
      JOIN companies c ON i.company_id = c.user_id
      WHERE i.id NOT IN (${excludedIds.map(() => '?').join(',')})
        AND i.status = 'active'
    `;
    
    const params = [...excludedIds];
    
    // ✅ إضافة شرط المهارات
    const skillConditions = [];
    skillsArray.forEach(skill => {
      skillConditions.push(`JSON_EXTRACT(i.required_skills, '$') LIKE ?`);
      params.push(`%${skill}%`);
    });
    
    // ✅ إضافة شرط الموقع
    const locationConditions = [];
    Array.from(locations).forEach(loc => {
      locationConditions.push(`i.location = ?`);
      params.push(loc);
    });
    
    // ✅ إضافة شرط النوع
    const typeConditions = [];
    Array.from(types).forEach(t => {
      typeConditions.push(`i.type = ?`);
      params.push(t);
    });
    
    // ✅ دمج جميع الشروط
    const allConditions = [...skillConditions, ...locationConditions, ...typeConditions];
    
    if (allConditions.length > 0) {
      sql += ` AND (${allConditions.join(' OR ')})`;
    }
    
    sql += ` LIMIT 6`;
    
    console.log('📝 SQL Query:', sql);
    console.log('📝 Params:', params);
    
    const [recommendations] = await db.execute(sql, params);
    
    console.log('📊 Found recommendations:', recommendations.length);
    
    // Calculate match score
    const formatted = recommendations.map(internship => {
      let score = 0;
      const internshipSkills = internship.required_skills ? JSON.parse(internship.required_skills) : [];
      
      // Match by skills (70%)
      if (internshipSkills.length > 0 && skills.size > 0) {
        const matchingSkills = internshipSkills.filter(skill => skills.has(skill)).length;
        score += (matchingSkills / Math.max(internshipSkills.length, 1)) * 70;
      }
      
      // Match by location (15%)
      if (locations.has(internship.location)) {
        score += 15;
      }
      
      // Match by type (15%)
      if (types.has(internship.type)) {
        score += 15;
      }
      
      console.log(`📊 Match score for ${internship.title}: ${Math.round(score)}%`);
      
      return {
        id: internship.id,
        title: internship.title,
        company: internship.company_name,
        location: internship.location,
        type: internship.type,
        stipend: internship.stipend,
        required_skills: internshipSkills,
        match_score: Math.round(score)
      };
    });
    
    // Sort by match score
    formatted.sort((a, b) => b.match_score - a.match_score);
    
    res.json({
      success: true,
      recommendations: formatted.slice(0, 3)
    });
    
  } catch (error) {
    console.error('🔥 Error getting recommendations:', error);
    res.json({ 
      success: true, 
      recommendations: [] 
    });
  }
});


// Agreements
app.get('/api/student/agreements', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.student_signed,
        a.company_signed,
        a.university_signed,
        a.generated_at,
        a.sent_at,
        a.signed_at,
        a.archived_at,
        a.pdf_url,
        a.university_name,
        a.created_at,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        i.title as internship_title,
        i.description,
        i.duration,
        i.stipend,
        i.location,
        i.type as internship_type,
        c.company_name,
        c.user_id as company_id
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      WHERE a.student_id = ?
      ORDER BY a.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      agreements
    });
  } catch (error) {
    console.error('🔥 Error fetching student agreements:', error);
    res.status(500).json({ success: false, message: 'Error fetching agreements' });
  }
});


app.get('/api/student/agreements/:agreementId', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const agreementId = req.params.agreementId;
    
    console.log(`🔍 Fetching agreement ${agreementId} for user ${userId}`);
    
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Students only.' 
      });
    }

    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.generated_at,
        a.sent_at,
        a.signed_at,
        a.archived_at,
        a.pdf_url,
        a.university_name,
        a.created_at,
        a.student_signed,
        a.company_signed,
        a.university_signed,
        a.signature_url,
        a.company_signature_url,
        a.university_signature_url,
        a.company_signed_at,        -- ✅ أضف هذا
        a.university_signed_at,     -- ✅ أضف هذا
        a.completed_at,              -- ✅ أضف هذا
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        i.title as internship_title,
        i.description,
        i.duration,
        i.stipend,
        i.location,
        i.type as internship_type,
        c.company_name,
        c.user_id as company_id
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      WHERE a.id = ? AND a.student_id = ?
    `, [agreementId, userId]);

    if (agreements.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }

    // ✅ إضافة console.log للتحقق من البيانات
    console.log('📤 Sending agreement data:', {
      id: agreements[0].id,
      company_signed_at: agreements[0].company_signed_at,
      university_signed_at: agreements[0].university_signed_at,
      completed_at: agreements[0].completed_at
    });

    res.json({
      success: true,
      agreement: agreements[0]
    });

  } catch (error) {
    console.error('🔥 Error fetching agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching agreement',
      error: error.message 
    });
  }
});


app.get('/api/student/agreements/:agreementId/download', protect, async (req, res) => {
  try {
    const studentId = req.user.id;
    const agreementId = req.params.agreementId;
    
    const [agreements] = await db.execute(`
      SELECT 
        a.*,
        i.title as internship_title,
        i.duration,
        i.stipend,
        i.start_date as internship_start_date,
        i.end_date as internship_end_date,
        s.first_name,
        s.last_name,
        s.university,
        s.student_id,
        s.phone as student_phone,
        s.social_security,
        s.academic_supervisor,
        c.company_name,
        c.address as company_address,
        c.contact_person as company_representative,
        c.phone as company_phone
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      WHERE a.id = ? AND a.student_id = ?
    `, [agreementId, studentId]);
    
    if (agreements.length === 0) {
      return res.status(404).json({ success: false, message: 'Agreement not found' });
    }
    
    const agreement = agreements[0];
    
    // ✅ حساب end_date تلقائياً إذا كان NULL
    let startDateValue = agreement.internship_start_date || agreement.created_at;
    let endDateValue = agreement.internship_end_date || '';
    
    if (!endDateValue && agreement.duration) {
      const start = new Date(startDateValue);
      const end = new Date(start);
      end.setMonth(end.getMonth() + (parseInt(agreement.duration) || 3));
      endDateValue = end.toISOString().split('T')[0];
      console.log('✅ Auto-calculated end_date for student:', endDateValue);
    }
    
    const pdfData = {
      studentName: `${agreement.first_name} ${agreement.last_name}`,
      companyName: agreement.company_name,
      companyAddress: agreement.company_address,
      companyRepresentative: agreement.company_representative,
      companyPhone: agreement.company_phone,
      studentId: agreement.student_id,
      socialSecurity: agreement.social_security,
      studentPhone: agreement.student_phone,
      internshipTitle: agreement.internship_title,
      supervisor: agreement.academic_supervisor,
      duration: agreement.duration,
      startDate: startDateValue,
      endDate: endDateValue,
      studentSignature: agreement.signature_url,
      companySignature: agreement.company_signature_url,
      universitySignature: agreement.university_signature_url
    };
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=convention_stage_${agreement.first_name}_${agreement.last_name}.pdf`);
    
    await generateConventionDeStagePDF(pdfData, res);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


app.put('/api/student/agreements/:agreementId/sign', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const studentId = req.user.id;
    const agreementId = req.params.agreementId;
    const { signature, signature_type } = req.body;
    
    console.log(`✍️ Student ${studentId} signing agreement ${agreementId} with ${signature_type} signature`);
    
    // التحقق من أن الاتفاقية موجودة وتخص هذا الطالب
    const [agreements] = await connection.execute(
      `SELECT a.*, i.company_id, i.title as internship_title,
              c.company_name, s.first_name, s.last_name, s.user_id as student_id
       FROM agreements a
       JOIN internships i ON a.internship_id = i.id
       JOIN companies c ON i.company_id = c.user_id
       JOIN students s ON a.student_id = s.user_id
       WHERE a.id = ? AND a.student_id = ?`,
      [agreementId, studentId]
    );
    
    if (agreements.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }
    
    const agreement = agreements[0];
    
    // التحقق من أن الاتفاقية لم توقع بعد
    if (agreement.student_signed) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Agreement already signed' 
      });
    }
    
    // حفظ التوقيع كصورة (Base64)
    let signaturePath = null;
    if (signature) {
      const base64Data = signature.replace(/^data:image\/png;base64,/, '');
      const signatureFileName = `signature_${studentId}_${agreementId}_${Date.now()}.png`;
      const signatureFilePath = path.join(__dirname, 'uploads', 'signatures', signatureFileName);
      
      const signatureDir = path.join(__dirname, 'uploads', 'signatures');
      if (!fs.existsSync(signatureDir)) {
        fs.mkdirSync(signatureDir, { recursive: true });
      }
      
      fs.writeFileSync(signatureFilePath, base64Data, 'base64');
      signaturePath = `/uploads/signatures/${signatureFileName}`;
    }
    
    // تحديث حالة التوقيع
    await connection.execute(
      `UPDATE agreements 
       SET student_signed = 1, 
           status = 'signed',
           signed_at = NOW(),
           signature_url = ?
       WHERE id = ?`,
      [signaturePath, agreementId]
    );
    
    // ✅ ✅ ✅ الكود الجديد: التحقق من اكتمال الاتفاقية ✅ ✅ ✅
    /*const [updatedAgreement] = await connection.execute(
      `SELECT student_signed, company_signed, university_signed 
       FROM agreements WHERE id = ?`,
      [agreementId]
    );
    
    if (updatedAgreement[0].student_signed === 1 && 
        updatedAgreement[0].company_signed === 1 && 
        updatedAgreement[0].university_signed === 1) {
      
      await connection.execute(
        `UPDATE agreements 
         SET status = 'completed', 
             completed_at = NOW() 
         WHERE id = ?`,
        [agreementId]
      );
      console.log('✅ Agreement fully completed by all parties!');
    }*/
    
    // إشعار للطالب
    await connection.execute(
      `INSERT INTO notifications 
       (user_id, type, title, message, application_id, created_at) 
       VALUES (?, 'agreement_signed', ?, ?, ?, NOW())`,
      [
        studentId,
        '✅ Agreement Signed',
        `You have successfully signed the agreement for "${agreement.internship_title}".`,
        agreement.application_id || null
      ]
    );
    
    // إشعار للشركة
    await connection.execute(
      `INSERT INTO company_notifications 
       (company_id, type, title, message, agreement_id, created_at) 
       VALUES (?, 'agreement_signed', ?, ?, ?, NOW())`,
      [
        agreement.company_id,
        '📄 Agreement Signed by Student',
        `${agreement.first_name} ${agreement.last_name} has signed the agreement for "${agreement.internship_title}".`,
        agreementId
      ]
    );
    
    // إشعار للإدارة
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, company_id, student_id, agreement_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'agreement_signed',
        '📄 Agreement Signed',
        `${agreement.first_name} ${agreement.last_name} has signed the agreement with ${agreement.company_name}.`,
        agreement.company_id,
        studentId,
        agreementId
      ]
    );
    
    await connection.commit();
    connection.release();
    
    res.json({ 
      success: true, 
      message: 'Agreement signed successfully' 
    });
    
  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('🔥 Error signing agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error signing agreement',
      error: error.message 
    });
  }
});



app.get('/api/student/agreements/:agreementId/download-with-signatures', protect, async (req, res) => {
  try {
    const studentId = req.user.id;
    const agreementId = req.params.agreementId;
    
    console.log(`📥 Generating PDF with signatures for agreement ${agreementId}`);
    
    // جلب بيانات الاتفاقية مع التوقيعات
    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.student_signed,
        a.company_signed,
        a.university_signed,
        a.signature_url,
        a.company_signature_url,
        a.university_signature_url,
        a.signature_type,
        a.company_signature_type,
        a.university_signature_type,
        a.typed_name,
        a.company_typed_name,
        a.university_typed_name,
        a.signed_at,
        a.completed_at,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.university,
        c.company_name,
        i.title as internship_title,
        i.duration,
        i.stipend
      FROM agreements a
      JOIN students s ON a.student_id = s.user_id
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE a.id = ? AND a.student_id = ?
    `, [agreementId, studentId]);
    
    if (agreements.length === 0) {
      return res.status(404).json({ success: false, message: 'Agreement not found' });
    }
    
    const agreement = agreements[0];
    
    // توليد PDF
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=agreement_${agreementId}_with_signatures.pdf`);
    doc.pipe(res);
    
    // ========== HEADER ==========
    doc.fontSize(20)
       .font('Helvetica-Bold')
       .text('INTERNSHIP AGREEMENT', { align: 'center' });
    
    doc.moveDown();
    doc.fontSize(10)
       .font('Helvetica')
       .text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
    
    doc.moveDown(2);
    
    // ========== PARTIES ==========
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('This Agreement is made between:');
    
    doc.moveDown();
    
    // Company Section
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('THE COMPANY');
    doc.font('Helvetica')
       .text(`Name: ${agreement.company_name}`);
    doc.text('(Hereinafter referred to as "The Company")');
    
    doc.moveDown();
    
    // Student Section
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('THE STUDENT');
    doc.font('Helvetica')
       .text(`Name: ${agreement.student_name}`);
    doc.text(`University: ${agreement.university}`);
    
    doc.moveDown();
    
    // Internship Position
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('INTERNSHIP POSITION');
    doc.font('Helvetica')
       .text(agreement.internship_title);
    
    doc.moveDown(2);
    
    // ========== TERMS AND CONDITIONS ==========
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('TERMS AND CONDITIONS');
    
    doc.moveDown();
    
    const terms = [
      '1. The student agrees to complete the internship period as specified in this agreement.',
      '2. The company agrees to provide necessary training, supervision, and resources.',
      '3. The university agrees to oversee the internship progress and provide academic supervision.',
      '4. Both parties agree to maintain confidentiality of any proprietary information.',
      '5. The internship will commence on the start date and continue for the agreed duration.',
      '6. Either party may terminate this agreement with 7 days written notice.',
      '7. The student agrees to abide by the company\'s policies and regulations.'
    ];
    
    terms.forEach(term => {
      doc.fontSize(9)
         .font('Helvetica')
         .text(term);
      doc.moveDown(0.5);
    });
    
    doc.moveDown(2);
    
    // ========== SIGNATURES SECTION ==========
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('SIGNATURES');
    
    doc.moveDown();
    
    // ==========================================
    // 1. COMPANY SIGNATURE
    // ==========================================
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('Company Representative:');
    
    if (agreement.company_signed === 1) {
      if (agreement.company_signature_url) {
        // عرض صورة توقيع الشركة
        const fs = require('fs');
        const path = require('path');
        const signatureFullPath = path.join(__dirname, agreement.company_signature_url);
        
        if (fs.existsSync(signatureFullPath)) {
          try {
            doc.image(signatureFullPath, 50, doc.y, { width: 150, height: 50 });
            doc.moveDown(3);
          } catch (err) {
            doc.font('Helvetica')
               .text('✓ Signed', 50, doc.y);
            doc.moveDown();
          }
        } else {
          doc.font('Helvetica')
             .text('✓ Signed', 50, doc.y);
          doc.moveDown();
        }
      } else if (agreement.company_typed_name) {
        doc.font('Helvetica')
           .text(`✓ Signed: ${agreement.company_typed_name}`, 50, doc.y);
        doc.moveDown();
      } else {
        doc.font('Helvetica')
           .text('✓ Signed', 50, doc.y);
        doc.moveDown();
      }
      doc.text(`Date: ${new Date(agreement.signed_at || Date.now()).toLocaleDateString()}`);
    } else {
      doc.font('Helvetica')
         .text('_________________________');
      doc.text('Name: ___________________');
    }
    
    doc.moveDown(2);
    
    // ==========================================
    // 2. STUDENT SIGNATURE
    // ==========================================
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('Student:');
    
    if (agreement.student_signed === 1) {
      if (agreement.signature_url) {
        // عرض صورة توقيع الطالب
        const fs = require('fs');
        const path = require('path');
        const signatureFullPath = path.join(__dirname, agreement.signature_url);
        
        if (fs.existsSync(signatureFullPath)) {
          try {
            doc.image(signatureFullPath, 50, doc.y, { width: 150, height: 50 });
            doc.moveDown(3);
          } catch (err) {
            doc.font('Helvetica')
               .text('✓ Signed', 50, doc.y);
            doc.moveDown();
          }
        } else {
          doc.font('Helvetica')
             .text('✓ Signed', 50, doc.y);
          doc.moveDown();
        }
      } else if (agreement.typed_name) {
        doc.font('Helvetica')
           .text(`✓ Signed: ${agreement.typed_name}`, 50, doc.y);
        doc.moveDown();
      } else {
        doc.font('Helvetica')
           .text('✓ Signed', 50, doc.y);
        doc.moveDown();
      }
      doc.text(`Name: ${agreement.student_name}`);
      doc.text(`Date: ${new Date(agreement.signed_at || Date.now()).toLocaleDateString()}`);
    } else {
      doc.font('Helvetica')
         .text('_________________________');
      doc.text(`Name: ${agreement.student_name}`);
    }
    
    doc.moveDown(2);
    
    // ==========================================
    // 3. UNIVERSITY SIGNATURE
    // ==========================================
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('University Supervisor:');
    
    if (agreement.university_signed === 1) {
      if (agreement.university_signature_url) {
        // عرض صورة توقيع الجامعة
        const fs = require('fs');
        const path = require('path');
        const signatureFullPath = path.join(__dirname, agreement.university_signature_url);
        
        if (fs.existsSync(signatureFullPath)) {
          try {
            doc.image(signatureFullPath, 50, doc.y, { width: 150, height: 50 });
            doc.moveDown(3);
          } catch (err) {
            doc.font('Helvetica')
               .text('✓ Signed', 50, doc.y);
            doc.moveDown();
          }
        } else {
          doc.font('Helvetica')
             .text('✓ Signed', 50, doc.y);
          doc.moveDown();
        }
      } else if (agreement.university_typed_name) {
        doc.font('Helvetica')
           .text(`✓ Signed: ${agreement.university_typed_name}`, 50, doc.y);
        doc.moveDown();
      } else {
        doc.font('Helvetica')
           .text('✓ Signed', 50, doc.y);
        doc.moveDown();
      }
      doc.text(`Date: ${new Date(agreement.completed_at || agreement.signed_at || Date.now()).toLocaleDateString()}`);
    } else {
      doc.font('Helvetica')
         .text('_________________________');
      doc.text('Name: ___________________');
    }
    
    doc.moveDown(2);
    
    // ========== FOOTER ==========
    doc.fontSize(8)
       .fillColor('#9CA3AF')
       .text('This agreement is legally binding upon signature by all parties.', { align: 'center' })
       .text(`Generated by STAG Platform on ${new Date().toLocaleDateString()}`, { align: 'center' });
    
    doc.end();
    
  } catch (error) {
    console.error('🔥 Error generating PDF with signatures:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error generating PDF',
      error: error.message 
    });
  }
});


app.put('/api/student/agreements/:agreementId/sign', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const studentId = req.user.id;
    const agreementId = req.params.agreementId;
    
    // ✅ IMPORTANT: Receive signature from Frontend
    const { signature, signature_type, typed_name } = req.body;
    
    console.log('\n' + '='.repeat(50));
    console.log('✍️ Signing agreement with signature');
    console.log('='.repeat(50));
    console.log('📌 Student ID:', studentId);
    console.log('📌 Agreement ID:', agreementId);
    console.log('📌 Signature Type:', signature_type);
    console.log('📌 Typed Name:', typed_name);
    console.log('📌 Signature Received:', signature ? 'Yes ✓' : 'No ✗');
    console.log('='.repeat(50) + '\n');
    
    // ✅ Check if signature exists
    if (!signature) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Please add your signature first' 
      });
    }
    
    // Check if agreement exists and belongs to this student
    const [agreements] = await connection.execute(
      `SELECT a.*, i.company_id, i.title as internship_title,
              c.company_name, s.first_name, s.last_name
       FROM agreements a
       JOIN internships i ON a.internship_id = i.id
       JOIN companies c ON i.company_id = c.user_id
       JOIN students s ON a.student_id = s.user_id
       WHERE a.id = ? AND a.student_id = ?`,
      [agreementId, studentId]
    );
    
    if (agreements.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }
    
    const agreement = agreements[0];
    
    // Check if agreement is already signed
    if (agreement.student_signed) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Agreement already signed' 
      });
    }
    
    // ✅ Save signature image on server
    let signaturePath = null;
    if (signature) {
      // Remove Base64 prefix (data:image/png;base64,)
      const base64Data = signature.replace(/^data:image\/png;base64,/, '');
      
      // Create unique filename
      const signatureFileName = `signature_${studentId}_${agreementId}_${Date.now()}.png`;
      const signatureFilePath = path.join(__dirname, 'uploads', 'signatures', signatureFileName);
      
      // Create signatures folder if it doesn't exist
      const signatureDir = path.join(__dirname, 'uploads', 'signatures');
      if (!fs.existsSync(signatureDir)) {
        fs.mkdirSync(signatureDir, { recursive: true });
        console.log('✅ Created signatures directory');
      }
      
      // Save the image
      fs.writeFileSync(signatureFilePath, base64Data, 'base64');
      signaturePath = `/uploads/signatures/${signatureFileName}`;
      console.log('✅ Signature saved at:', signaturePath);
    }
    
    // ✅ Update agreement with signature path
    await connection.execute(
      `UPDATE agreements 
       SET student_signed = 1, 
           status = 'signed',
           signed_at = NOW(),
           signature_url = ?,
           signature_type = ?,
           typed_name = ?
       WHERE id = ?`,
      [signaturePath, signature_type, typed_name || null, agreementId]
    );

    // ✅ ✅ ✅ أضف هذا الجزء هنا ✅ ✅ ✅
const [updatedAgreement] = await connection.execute(
    'SELECT student_signed, company_signed, university_signed FROM agreements WHERE id = ?',
    [agreementId]
);

if (updatedAgreement[0].student_signed === 1 && 
    updatedAgreement[0].company_signed === 1 && 
    updatedAgreement[0].university_signed === 1) {
    await connection.execute(
        'UPDATE agreements SET status = "completed", completed_at = NOW() WHERE id = ?',
        [agreementId]
    );
    console.log('✅ Agreement fully completed!');
}
    
    console.log('✅ Agreement updated in database');

    // Notification for student
    await connection.execute(
      `INSERT INTO notifications 
       (user_id, type, title, message, agreement_id, created_at) 
       VALUES (?, 'agreement_signed', ?, ?, ?, NOW())`,
      [
        studentId,
        '✅ Agreement Signed',
        `You have successfully signed the agreement for "${agreement.internship_title}".`,
        agreementId
      ]
    );
    
    // Notification for company
    await connection.execute(
      `INSERT INTO company_notifications 
       (company_id, type, title, message, agreement_id, created_at) 
       VALUES (?, 'agreement_signed', ?, ?, ?, NOW())`,
      [
        agreement.company_id,
        '📄 Agreement Signed by Student',
        `${agreement.first_name} ${agreement.last_name} has signed the agreement for "${agreement.internship_title}".`,
        agreementId
      ]
    );
    
    // Notification for admin
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, company_id, student_id, agreement_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'agreement_signed',
        '📄 Agreement Signed',
        `${agreement.first_name} ${agreement.last_name} has signed the agreement with ${agreement.company_name}.`,
        agreement.company_id,
        studentId,
        agreementId
      ]
    );
    
    await connection.commit();
    connection.release();
    
    console.log('✅ Operation completed successfully\n');
    
    res.json({ 
      success: true, 
      message: '✅ Agreement signed successfully!' 
    });
    
  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('🔥 Error signing agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error signing agreement: ' + error.message,
      error: error.message 
    });
  }
});



// Notifications
app.get('/api/student/notifications', protect, async (req, res) => {
  try {
    // ✅ التحقق من أن المستخدم طالب
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Students only.' 
      });
    }

    const userId = req.user.id;

    const [notifications] = await db.execute(
      `SELECT * FROM notifications 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId]
    );

    console.log(`📨 Found ${notifications.length} notifications for student ${userId}`);

    res.json({
      success: true,
      notifications: notifications
    });

  } catch (error) {
    console.error('🔥 Error fetching student notifications:', error);
    res.json({ 
      success: true, 
      notifications: [] 
    });
  }
});


app.put('/api/student/notifications/:id/read', protect, async (req, res) => {
  try {
    // ✅ التحقق من أن المستخدم طالب
    if (req.user.user_type !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Students only.'
      });
    }

    const notificationId = req.params.id;
    const userId = req.user.id;

    // ✅ تحديث الإشعار (نفس طريقة Company)
    const [result] = await db.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [notificationId, userId]
    );

    // ✅ التحقق من نجاح التحديث
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // ✅ رسالة نجاح
    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('🔥 Error marking student notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification'
    });
  }
});


app.put('/api/student/notifications/:id/read', protect, async (req, res) => {
    try {
        const notificationId = req.params.id;
        const userId = req.user.id;
        
        console.log(`📨 Marking notification ${notificationId} as read for user ${userId}`);
        
        // ✅ تحديث قاعدة البيانات فعلياً
        const [result] = await db.execute(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
            [notificationId, userId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found or already read'
            });
        }
        
        console.log(`✅ Notification ${notificationId} marked as read`);
        
        res.json({
            success: true,
            message: 'Notification marked as read'
        });
        
    } catch (error) {
        console.error('🔥 Error marking notification:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating notification'
        });
    }
});


app.put('/api/student/notifications/read-all', protect, async (req, res) => {
  try {
    // ✅ التحقق من أن المستخدم طالب
    if (req.user.user_type !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Students only.'
      });
    }

    const userId = req.user.id;

    const [result] = await db.execute(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ?',
      [userId]
    );

    console.log(`✅ Marked ${result.affectedRows} student notifications as read for user ${userId}`);

    res.json({
      success: true,
      message: `All notifications marked as read (${result.affectedRows} notifications)`,
      count: result.affectedRows
    });

  } catch (error) {
    console.error('🔥 Error marking all student notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notifications'
    });
  }
});


// ============================================
// EXPERIENCE ROUTES (باستخدام JSON في جدول students)
// ============================================

// ✅ جلب جميع خبرات الطالب
app.get('/api/student/experiences', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Students only.'
            });
        }

        const studentId = req.user.id;

        const [students] = await db.execute(
            'SELECT experiences FROM students WHERE user_id = ?',
            [studentId]
        );

        let experiences = [];
        if (students[0]?.experiences) {
            try {
                experiences = typeof students[0].experiences === 'string' 
                    ? JSON.parse(students[0].experiences) 
                    : students[0].experiences;
            } catch (e) {
                experiences = [];
            }
        }

        res.json({
            success: true,
            experiences: experiences
        });

    } catch (error) {
        console.error('Error fetching experiences:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching experiences'
        });
    }
});

// ✅ إضافة/تحديث/حذف الخبرات (كلها في عملية واحدة)
app.post('/api/student/experiences', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Students only.'
            });
        }

        const studentId = req.user.id;
        const { experiences } = req.body;

        // تحديث عمود experiences في جدول students
        await db.execute(
            'UPDATE students SET experiences = ? WHERE user_id = ?',
            [JSON.stringify(experiences || []), studentId]
        );

        res.json({
            success: true,
            message: 'Experiences saved successfully'
        });

    } catch (error) {
        console.error('Error saving experiences:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving experiences'
        });
    }
});

// ✅ حذف خبرة محددة
app.delete('/api/student/experiences/:experienceId', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Students only.'
            });
        }

        const studentId = req.user.id;
        const experienceId = parseInt(req.params.experienceId);

        // جلب الخبرات الحالية
        const [students] = await db.execute(
            'SELECT experiences FROM students WHERE user_id = ?',
            [studentId]
        );

        let experiences = [];
        if (students[0]?.experiences) {
            try {
                experiences = typeof students[0].experiences === 'string' 
                    ? JSON.parse(students[0].experiences) 
                    : students[0].experiences;
            } catch (e) {
                experiences = [];
            }
        }

        // حذف الخبرة المحددة
        const updatedExperiences = experiences.filter(exp => exp.id !== experienceId);

        // حفظ التغييرات
        await db.execute(
            'UPDATE students SET experiences = ? WHERE user_id = ?',
            [JSON.stringify(updatedExperiences), studentId]
        );

        res.json({
            success: true,
            message: 'Experience deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting experience:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting experience'
        });
    }
});


// Settings & Account
app.get('/api/student/settings', protect, async (req, res) => {
  console.log('📥 ========== FETCH SETTINGS ==========');
  console.log('📥 User ID:', req.user.id);
  
  try {
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Students only.' 
      });
    }

    const userId = req.user.id;
    
    // ✅ جلب الإعدادات من قاعدة البيانات
    const [settings] = await db.execute(
      'SELECT settings FROM student_settings WHERE user_id = ?',
      [userId]
    );

    console.log('📥 Raw settings from DB:', settings[0]?.settings);

    if (settings.length > 0 && settings[0].settings) {
      try {
        const settingsData = JSON.parse(settings[0].settings);
        console.log('📥 Parsed settings:', JSON.stringify(settingsData, null, 2));
        return res.json({
          success: true,
          settings: settingsData
        });
      } catch (parseError) {
        console.error('❌ Error parsing settings:', parseError);
      }
    }

    // ✅ إعدادات افتراضية إذا لم تكن موجودة
    const defaultSettings = {
      account: {
        emailNotifications: true,
        applicationUpdates: true,
        deadlineReminders: true,
        newMatches: true,
        newsletter: false
      },
      privacy: {
        profileVisibility: 'public',
        showContactInfo: true,
        allowMessages: true,
        showSavedInternships: false,
        showApplications: true,
        dataSharing: true
      },
      preferences: {
        preferredLocations: [],
        internshipTypes: ['remote', 'part-time', 'full-time'],
        minStipend: 0,
        notificationFrequency: 'instant',
        language: 'en',
        theme: 'light'
      }
    };

    console.log('📥 Using default settings');
    res.json({
      success: true,
      settings: defaultSettings
    });

  } catch (error) {
    console.error('❌ Error in settings endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settings'
    });
  }
});


app.put('/api/student/settings', protect, async (req, res) => {
  console.log('📥 ========== SAVE SETTINGS ==========');
  console.log('📥 User ID:', req.user.id);
  console.log('📥 Received data:', JSON.stringify(req.body, null, 2));
  
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    if (req.user.user_type !== 'student') {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Students only.' 
      });
    }

    const userId = req.user.id;
    const settingsData = req.body;

    // ✅ تحقق من وجود الجدول
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'student_settings'"
    );

    if (tables.length === 0) {
      console.log('⚠️ Table student_settings does not exist, creating...');
      await connection.execute(`
        CREATE TABLE student_settings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL UNIQUE,
          settings JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    }

    // ✅ تحقق من وجود إعدادات مسبقة
    const [existing] = await connection.execute(
      'SELECT id FROM student_settings WHERE user_id = ?',
      [userId]
    );

    const jsonData = JSON.stringify(settingsData);
    console.log('📥 Saving JSON:', jsonData);

    if (existing.length > 0) {
      // تحديث الإعدادات الموجودة
      const [updateResult] = await connection.execute(
        'UPDATE student_settings SET settings = ?, updated_at = NOW() WHERE user_id = ?',
        [jsonData, userId]
      );
      console.log('📥 Update result:', updateResult);
    } else {
      // إدراج إعدادات جديدة
      const [insertResult] = await connection.execute(
        'INSERT INTO student_settings (user_id, settings) VALUES (?, ?)',
        [userId, jsonData]
      );
      console.log('📥 Insert result:', insertResult);
    }

    await connection.commit();
    connection.release();

    // ✅ التحقق من البيانات بعد الحفظ
    const [verify] = await db.execute(
      'SELECT settings FROM student_settings WHERE user_id = ?',
      [userId]
    );
    console.log('📥 Verified saved data:', verify[0]?.settings);

    res.json({
      success: true,
      message: 'Settings saved successfully'
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('❌ Error saving settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving settings: ' + error.message
    });
  }
});


app.put('/api/student/change-password', protect, async (req, res) => {
  console.log('\n🔐 === CHANGE PASSWORD REQUEST ===');
  
  try {
    // التحقق من نوع المستخدم
    if (req.user.user_type !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Students only.' 
      });
    }

    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    console.log('User ID:', userId);
    console.log('Current Password provided:', currentPassword ? 'Yes' : 'No');
    console.log('New Password provided:', newPassword ? 'Yes' : 'No');

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // ✅ استخدام db.execute مباشرة (الصحيح)
    const [users] = await db.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('Current password hash:', users[0].password.substring(0, 30) + '...');

    // التحقق من كلمة المرور الحالية
    const isPasswordValid = await bcrypt.compare(currentPassword, users[0].password);
    console.log('Password valid:', isPasswordValid);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // تشفير كلمة المرور الجديدة
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    console.log('New password hash:', hashedPassword.substring(0, 30) + '...');

    // ✅ تحديث كلمة المرور - استخدام db.execute مباشرة
    const [updateResult] = await db.execute(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, userId]
    );

    console.log('Update result:', updateResult);
    console.log('Rows affected:', updateResult.affectedRows);

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // ✅ التحقق من التحديث
    const [verifyUser] = await db.execute(
      'SELECT password, updated_at FROM users WHERE id = ?',
      [userId]
    );

    console.log('Password after update:', verifyUser[0].password.substring(0, 30) + '...');
    console.log('Updated at:', verifyUser[0].updated_at);

    // مقارنة إذا تغيرت كلمة المرور
    if (verifyUser[0].password === users[0].password) {
      console.log('❌ ERROR: Password did not change in database!');
      return res.status(500).json({
        success: false,
        message: 'Password update failed in database'
      });
    }

    console.log('✅ Password changed successfully in database');
    console.log('=====================================\n');

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('🔥 Error in change-password:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error changing password: ' + error.message
    });
  }
});


app.delete('/api/student/account', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    if (req.user.user_type !== 'student') {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Students only.' 
      });
    }

    const userId = req.user.id;
    const { password } = req.body;

    // Verify password
    const [users] = await connection.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, users[0].password);
    
    if (!isPasswordValid) {
      await connection.rollback();
      connection.release();
      return res.status(401).json({
        success: false,
        message: 'Password is incorrect'
      });
    }

    // Delete user (cascade will delete all related data)
    await connection.execute(
      'DELETE FROM users WHERE id = ?',
      [userId]
    );

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('Error deleting account:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting account'
    });
  }
});


app.get('/api/student/deadlines', protect, async (req, res) => {
  try {
    const studentId = req.user.id;
    
    console.log('📅 Fetching deadlines for student:', studentId);
    
    let deadlines = [];
    let agreementDeadlines = [];
    
    // ✅ جلب التطبيقات النشطة (بدون application_deadline)
    try {
      const [applications] = await db.execute(`
        SELECT 
          si.id,
          i.title as internship_title,
          i.deadline as deadline_date,
          c.company_name,
          si.status,
          si.applied_at
        FROM student_internships si
        JOIN internships i ON si.internship_id = i.id
        JOIN companies c ON i.company_id = c.user_id
        WHERE si.student_id = ? 
          AND si.status IN ('pending', 'reviewed', 'interview')
          AND i.deadline IS NOT NULL
          AND i.deadline >= CURDATE()
        ORDER BY i.deadline ASC
        LIMIT 5
      `, [studentId]);
      
      deadlines = applications.map(app => {
        const deadlineDate = new Date(app.deadline_date);
        const today = new Date();
        const diffTime = deadlineDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return {
          id: app.id,
          title: app.internship_title,
          company: app.company_name,
          deadline: app.deadline_date,
          daysLeft: diffDays > 0 ? diffDays : 0,
          status: app.status,
          type: 'application_deadline'
        };
      });
    } catch (err) {
      console.log('⚠️ No applications found:', err.message);
    }
    
    // ✅ جلب المواعيد النهائية للاتفاقيات
    try {
      // ✅ أضف JOIN كما في استعلام التطبيقات
const [agreements] = await db.execute(`
  SELECT 
    a.id,
    i.title as internship_title,
    c.company_name,
    a.created_at,
    a.status,
    DATE_ADD(a.created_at, INTERVAL 7 DAY) as signing_deadline
  FROM agreements a
  JOIN internships i ON a.internship_id = i.id
  JOIN companies c ON i.company_id = c.user_id
  WHERE a.student_id = ? 
    AND a.status = 'pending'
  ORDER BY a.created_at ASC
  LIMIT 3
`, [studentId]);
      
      agreementDeadlines = agreements.map(ag => {
        const deadlineDate = new Date(ag.signing_deadline);
        const today = new Date();
        const diffTime = deadlineDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return {
          id: ag.id,
          title: `Sign agreement for ${ag.internship_title}`,
          company: ag.company_name,
          deadline: ag.signing_deadline,
          daysLeft: diffDays > 0 ? diffDays : 0,
          status: ag.status,
          type: 'agreement_deadline'
        };
      });
    } catch (err) {
      console.log('⚠️ No agreements found:', err.message);
    }
    
    // دمج جميع المواعيد النهائية
    const allDeadlines = [...deadlines, ...agreementDeadlines];
    
    // ترتيب حسب الأقرب
    allDeadlines.sort((a, b) => a.daysLeft - b.daysLeft);
    
    console.log(`✅ Found ${allDeadlines.length} deadlines for student ${studentId}`);
    
    res.json({
      success: true,
      deadlines: allDeadlines.slice(0, 5)
    });
    
  } catch (error) {
    console.error('❌ Error fetching deadlines:', error);
    res.json({ 
      success: true, 
      deadlines: []
    });
  }
});


app.post('/api/student/rate-company', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const studentId = req.user.id;
    const {
      company_id,
      internship_id,
      agreement_id,
      rating,
      review,
      would_recommend,
      communication_rating,
      supervision_rating,
      learning_rating,
      work_environment_rating
    } = req.body;

    // التحقق من أن الطالب أكمل التدريب
    const [agreements] = await connection.execute(
      'SELECT id FROM agreements WHERE id = ? AND student_id = ? AND status = "completed"',
      [agreement_id, studentId]
    );

    if (agreements.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({
        success: false,
        message: 'You can only rate companies after completing the internship'
      });
    }

    // إضافة التقييم
    await connection.execute(
      `INSERT INTO company_ratings 
       (student_id, company_id, internship_id, agreement_id, rating, review, 
        would_recommend, communication_rating, supervision_rating, 
        learning_rating, work_environment_rating)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId, company_id, internship_id, agreement_id, rating, review,
        would_recommend, communication_rating, supervision_rating,
        learning_rating, work_environment_rating
      ]
    );

    // حساب متوسط التقييم للشركة
    const [avgRating] = await connection.execute(
      `SELECT AVG(rating) as average_rating 
       FROM company_ratings 
       WHERE company_id = ?`,
      [company_id]
    );

    // تحديث متوسط التقييم في جدول الشركات
    await connection.execute(
      'UPDATE companies SET average_rating = ? WHERE user_id = ?',
      [avgRating[0].average_rating, company_id]
    );

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Rating submitted successfully'
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('Error submitting rating:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting rating'
    });
  }
});





// 🏢 COMPANY ROUTES

// Profile Management
app.get('/api/company/profile', protect, async (req, res) => {
  try {
    // Verify user is company
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const userId = req.user.id;

    // Get company profile
    const [companies] = await db.execute(
      `SELECT 
        c.*,
        u.email,
        u.created_at as account_created_at
      FROM companies c
      JOIN users u ON c.user_id = u.id
      WHERE c.user_id = ?`,
      [userId]
    );

    if (companies.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company profile not found'
      });
    }

    const company = companies[0];

    // Parse JSON fields
    let social_media = {};
    if (company.social_media) {
      try {
        social_media = typeof company.social_media === 'string' 
          ? JSON.parse(company.social_media) 
          : company.social_media;
      } catch (e) {
        social_media = {};
      }
    }

    res.json({
      success: true,
      profile: {
        ...company,
        social_media
      }
    });

  } catch (error) {
    console.error('🔥 Error fetching company profile:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching company profile'
    });
  }
});


app.put('/api/company/profile', 
  protect, 
  companyUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'cover_image', maxCount: 1 }
  ]), 
  async (req, res) => {
    let connection;
    
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      console.log('✅ Company profile update started');
      console.log('👤 User ID:', req.user.id);
      console.log('📦 Body:', req.body);
      console.log('🖼️ Files:', req.files ? Object.keys(req.files) : 'No files');

      // Verify user is company
      if (req.user.user_type !== 'company') {
        await connection.rollback();
        connection.release();
        return res.status(403).json({ 
          success: false, 
          message: 'Access denied. Company only.' 
        });
      }

      const userId = req.user.id;
      const {
        company_name,
        company_email,
        phone,
        website,
        trade_register,
        activity_sector,
        company_size,
        wilaya,
        address,
        contact_person,
        position,
        personal_email,
        description,
        founded_year,
        tax_id,
        social_media
      } = req.body;

      // ✅ التأكد من وجود الشركة في قاعدة البيانات
      const [checkCompany] = await connection.execute(
        'SELECT id FROM companies WHERE user_id = ?',
        [userId]
      );

      if (checkCompany.length === 0) {
        console.log('⚠️ Company not found, creating new record...');
        const newCompanyName = company_name || 'New Company';
        const newCompanyEmail = company_email || `company${userId}@temp.com`;
        await connection.execute(
          `INSERT INTO companies 
           (user_id, company_name, company_email, created_at) 
           VALUES (?, ?, ?, NOW())`,
          [userId, newCompanyName, newCompanyEmail]
        );
        console.log('✅ New company created for user ID:', userId);
      }

      // Get current profile to check old files
      const [currentProfile] = await connection.execute(
        'SELECT logo_url, cover_image_url FROM companies WHERE user_id = ?',
        [userId]
      );

      // Handle file uploads
      let logo_url = currentProfile[0]?.logo_url;
      let cover_image_url = currentProfile[0]?.cover_image_url;

      if (req.files) {
        // Upload new logo
        if (req.files.logo) {
          if (logo_url) {
            const oldLogoPath = path.join(__dirname, logo_url);
            if (fs.existsSync(oldLogoPath)) {
              fs.unlinkSync(oldLogoPath);
              console.log('✅ Old logo deleted');
            }
          }
          logo_url = `/uploads/companies/${req.files.logo[0].filename}`;
          console.log('✅ New logo uploaded:', logo_url);
        }

        // Upload new cover image
        if (req.files.cover_image) {
          if (cover_image_url) {
            const oldCoverPath = path.join(__dirname, cover_image_url);
            if (fs.existsSync(oldCoverPath)) {
              fs.unlinkSync(oldCoverPath);
              console.log('✅ Old cover deleted');
            }
          }
          cover_image_url = `/uploads/companies/${req.files.cover_image[0].filename}`;
          console.log('✅ New cover uploaded:', cover_image_url);
        }
      }

      // ✅ ✅ ✅ أضف هذا الكود هنا ✅ ✅ ✅
      // Handle logo deletion from frontend (when logo_url is sent as empty string)
      if (req.body.logo_url !== undefined) {
        if (req.body.logo_url === '' || req.body.logo_url === 'null') {
          // Delete old file if exists
          if (logo_url) {
            const oldLogoPath = path.join(__dirname, logo_url);
            if (fs.existsSync(oldLogoPath)) {
              fs.unlinkSync(oldLogoPath);
              console.log('🗑️ Logo file deleted from server');
            }
          }
          logo_url = null;
          console.log('🗑️ Logo will be deleted from database');
        }
      }

      // Handle cover image deletion from frontend
      if (req.body.cover_image_url !== undefined) {
        if (req.body.cover_image_url === '' || req.body.cover_image_url === 'null') {
          // Delete old file if exists
          if (cover_image_url) {
            const oldCoverPath = path.join(__dirname, cover_image_url);
            if (fs.existsSync(oldCoverPath)) {
              fs.unlinkSync(oldCoverPath);
              console.log('🗑️ Cover file deleted from server');
            }
          }
          cover_image_url = null;
          console.log('🗑️ Cover image will be deleted from database');
        }
      }

      // Parse social_media
      let social_media_json = null;
      if (social_media) {
        try {
          social_media_json = typeof social_media === 'string' 
            ? social_media 
            : JSON.stringify(social_media);
        } catch (e) {
          social_media_json = JSON.stringify({});
        }
      }

      // Build update query
      const updateFields = [];
      const updateValues = [];

      if (company_name !== undefined && company_name !== '') {
        updateFields.push('company_name = ?');
        updateValues.push(company_name);
      }
      if (company_email !== undefined && company_email !== '') {
        updateFields.push('company_email = ?');
        updateValues.push(company_email);
      }
      if (phone !== undefined) {
        updateFields.push('phone = ?');
        updateValues.push(phone || null);
      }
      if (website !== undefined) {
        updateFields.push('website = ?');
        updateValues.push(website || null);
      }
      if (trade_register !== undefined && trade_register !== '') {
        updateFields.push('trade_register = ?');
        updateValues.push(trade_register);
      }
      if (activity_sector !== undefined) {
        updateFields.push('activity_sector = ?');
        updateValues.push(activity_sector || null);
      }
      if (company_size !== undefined) {
        updateFields.push('company_size = ?');
        updateValues.push(company_size || null);
      }
      if (wilaya !== undefined && wilaya !== '') {
        updateFields.push('wilaya = ?');
        updateValues.push(wilaya);
      }
      if (address !== undefined) {
        updateFields.push('address = ?');
        updateValues.push(address || null);
      }
      if (contact_person !== undefined && contact_person !== '') {
        updateFields.push('contact_person = ?');
        updateValues.push(contact_person);
      }
      if (position !== undefined) {
        updateFields.push('position = ?');
        updateValues.push(position || null);
      }
      if (personal_email !== undefined) {
        updateFields.push('personal_email = ?');
        updateValues.push(personal_email || null);
      }
      if (description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(description || null);
      }
      if (founded_year !== undefined) {
        updateFields.push('founded_year = ?');
        updateValues.push(founded_year || null);
      }
      if (tax_id !== undefined) {
        updateFields.push('tax_id = ?');
        updateValues.push(tax_id || null);
      }
      
      // ✅ أضف logo_url و cover_image_url بعد معالجتهما
      if (logo_url !== undefined) {
        updateFields.push('logo_url = ?');
        updateValues.push(logo_url);
      }
      if (cover_image_url !== undefined) {
        updateFields.push('cover_image_url = ?');
        updateValues.push(cover_image_url);
      }
      
      if (social_media_json) {
        updateFields.push('social_media = ?');
        updateValues.push(social_media_json);
      }

      // Always update profile_completed and updated_at
      updateFields.push('profile_completed = 1');
      updateFields.push('updated_at = NOW()');

      if (updateFields.length > 0) {
        updateValues.push(userId);
        
        const sql = `UPDATE companies SET ${updateFields.join(', ')} WHERE user_id = ?`;
        console.log('📝 SQL Query:', sql);
        console.log('📝 Values:', updateValues);
        
        const [result] = await connection.execute(sql, updateValues);
        console.log('✅ Update result:', result);
      }

      // Update email in users table if changed
      if (company_email && company_email !== '') {
        await connection.execute(
          'UPDATE users SET email = ? WHERE id = ?',
          [company_email, userId]
        );
        console.log('✅ User email updated');
      }

      await connection.commit();
      console.log('✅ Transaction committed');

      // Get updated profile
      const [updatedProfile] = await db.execute(
        'SELECT * FROM companies WHERE user_id = ?',
        [userId]
      );

      res.json({
        success: true,
        message: 'Company profile updated successfully',
        profile: updatedProfile[0] || null
      });

    } catch (error) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      
      console.error('🔥 Error updating company profile:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error updating company profile: ' + error.message
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
});


// Dashboard & Analytics
app.get('/api/company/dashboard-stats', protect, async (req, res) => {
  try {
    // Verify user is company
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const userId = req.user.id;

    // التحقق من وجود جدول internships
    const [tables] = await db.execute(
      "SHOW TABLES LIKE 'internships'"
    );

    if (tables.length === 0) {
      // جدول غير موجود -> أرجع إحصائيات فارغة
      return res.json({
        success: true,
        stats: {
          totalInternships: 0,
          totalApplications: 0,
          pendingApplications: 0,
          interviewApplications: 0,
          acceptedApplications: 0
        }
      });
    }

    // Get total internships - مع معالجة الأخطاء
    let totalInternships = 0;
    try {
      const [internships] = await db.execute(
        'SELECT COUNT(*) as count FROM internships WHERE company_id = ?',
        [userId]
      );
      totalInternships = internships[0]?.count || 0;
    } catch (err) {
      console.log('⚠️ Error counting internships:', err.message);
    }

    // التحقق من وجود جدول student_internships
    const [appsTable] = await db.execute(
      "SHOW TABLES LIKE 'student_internships'"
    );

    if (appsTable.length === 0) {
      return res.json({
        success: true,
        stats: {
          totalInternships,
          totalApplications: 0,
          pendingApplications: 0,
          interviewApplications: 0,
          acceptedApplications: 0
        }
      });
    }

    // Get application stats - مع معالجة الأخطاء
    let totalApplications = 0;
    let pendingApplications = 0;
    let interviewApplications = 0;
    let acceptedApplications = 0;

    try {
      const [applications] = await db.execute(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN si.status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN si.status = 'interview' THEN 1 ELSE 0 END) as interview,
          SUM(CASE WHEN si.status = 'accepted' THEN 1 ELSE 0 END) as accepted
        FROM student_internships si
        JOIN internships i ON si.internship_id = i.id
        WHERE i.company_id = ?`,
        [userId]
      );

      if (applications.length > 0) {
        totalApplications = applications[0].total || 0;
        pendingApplications = applications[0].pending || 0;
        interviewApplications = applications[0].interview || 0;
        acceptedApplications = applications[0].accepted || 0;
      }
    } catch (err) {
      console.log('⚠️ Error counting applications:', err.message);
    }

    res.json({
      success: true,
      stats: {
        totalInternships,
        totalApplications,
        pendingApplications,
        interviewApplications,
        acceptedApplications
      }
    });

  } catch (error) {
    console.error('🔥 Error fetching dashboard stats:', error);
    // ✅ أرجع إحصائيات فارغة بدلاً من خطأ
    res.json({
      success: true,
      stats: {
        totalInternships: 0,
        totalApplications: 0,
        pendingApplications: 0,
        interviewApplications: 0,
        acceptedApplications: 0
      }
    });
  }
});


app.get('/api/company/analytics', protect, async (req, res) => {
  try {
    // التحقق من أن المستخدم شركة
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    
    console.log(`📊 Fetching analytics for company: ${companyId}`);
    
    // 1️⃣ إجمالي الزيارات للتدريبات
    let totalViews = 0;
    try {
      const [views] = await db.execute(`
        SELECT COALESCE(SUM(views_count), 0) as total_views 
        FROM internships 
        WHERE company_id = ?
      `, [companyId]);
      totalViews = views[0]?.total_views || 0;
    } catch (err) {
      console.log('⚠️ Error counting views:', err.message);
    }
    
    // 2️⃣ إحصائيات التقديمات
    let totalApplications = 0;
    let acceptedApplications = 0;
    let rejectedApplications = 0;
    let interviewApplications = 0;
    
    try {
      const [applications] = await db.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN si.status = 'accepted' THEN 1 ELSE 0 END) as accepted,
          SUM(CASE WHEN si.status = 'rejected' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN si.status = 'interview' THEN 1 ELSE 0 END) as interview
        FROM student_internships si
        JOIN internships i ON si.internship_id = i.id
        WHERE i.company_id = ?
      `, [companyId]);
      
      if (applications.length > 0) {
        totalApplications = applications[0].total || 0;
        acceptedApplications = applications[0].accepted || 0;
        rejectedApplications = applications[0].rejected || 0;
        interviewApplications = applications[0].interview || 0;
      }
    } catch (err) {
      console.log('⚠️ Error counting applications:', err.message);
    }
    
    // 3️⃣ نسبة القبول
    const acceptanceRate = totalApplications > 0 
      ? Math.round((acceptedApplications / totalApplications) * 100)
      : 0;
    
    // 4️⃣ معدل التحويل (من مشاهدة إلى تقديم)
    const conversionRate = totalViews > 0 
      ? Math.round((totalApplications / totalViews) * 100)
      : 0;
    
    // 5️⃣ متوسط تقييم الشركة
    let averageRating = 0;
    try {
      const [rating] = await db.execute(`
        SELECT COALESCE(AVG(rating), 0) as avg_rating 
        FROM company_ratings 
        WHERE company_id = ?
      `, [companyId]);
      averageRating = rating[0]?.avg_rating || 0;
    } catch (err) {
      console.log('⚠️ Error fetching rating:', err.message);
    }
    
    // 6️⃣ التقديمات حسب الشهر (آخر 6 أشهر)
    let monthlyApplications = [];
    try {
      const [monthly] = await db.execute(`
        SELECT 
          DATE_FORMAT(si.applied_at, '%Y-%m') as month,
          COUNT(*) as count
        FROM student_internships si
        JOIN internships i ON si.internship_id = i.id
        WHERE i.company_id = ?
          AND si.applied_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP BY DATE_FORMAT(si.applied_at, '%Y-%m')
        ORDER BY month DESC
      `, [companyId]);
      monthlyApplications = monthly;
    } catch (err) {
      console.log('⚠️ Error fetching monthly apps:', err.message);
    }
    
    // 7️⃣ المهارات الأكثر طلباً في تدريباتك
    let topSkills = [];
    try {
      const [skills] = await db.execute(`
        SELECT required_skills
        FROM internships
        WHERE company_id = ?
      `, [companyId]);
      
      const skillCount = {};
      skills.forEach(internship => {
        if (internship.required_skills) {
          try {
            const skillsList = JSON.parse(internship.required_skills);
            skillsList.forEach(skill => {
              const skillName = skill.toLowerCase();
              skillCount[skillName] = (skillCount[skillName] || 0) + 1;
            });
          } catch (e) {
            // تجاهل الأخطاء في JSON
          }
        }
      });
      
      topSkills = Object.entries(skillCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([skill, count]) => ({ skill, count }));
    } catch (err) {
      console.log('⚠️ Error fetching top skills:', err.message);
    }
    
    // 8️⃣ عدد التدريبات النشطة
    let activeInternships = 0;
    try {
      const [active] = await db.execute(`
        SELECT COUNT(*) as count 
        FROM internships 
        WHERE company_id = ? AND status = 'active'
      `, [companyId]);
      activeInternships = active[0]?.count || 0;
    } catch (err) {
      console.log('⚠️ Error counting active internships:', err.message);
    }
    
    // 9️⃣ عدد التدريبات المملوءة
    let filledInternships = 0;
    try {
      const [filled] = await db.execute(`
        SELECT COUNT(*) as count 
        FROM internships 
        WHERE company_id = ? AND status = 'filled'
      `, [companyId]);
      filledInternships = filled[0]?.count || 0;
    } catch (err) {
      console.log('⚠️ Error counting filled internships:', err.message);
    }
    
    console.log('📊 Analytics results:', {
      totalViews,
      totalApplications,
      acceptanceRate,
      averageRating,
      activeInternships
    });
    
    res.json({
      success: true,
      analytics: {
        totalViews,
        totalApplications,
        acceptedApplications,
        rejectedApplications,
        interviewApplications,
        acceptanceRate,
        conversionRate,
        averageRating: parseFloat(averageRating).toFixed(1),
        monthlyApplications,
        topSkills,
        activeInternships,
        filledInternships
      }
    });
    
  } catch (error) {
    console.error('🔥 Error fetching analytics:', error);
    res.json({
      success: true,
      analytics: {
        totalViews: 0,
        totalApplications: 0,
        acceptedApplications: 0,
        rejectedApplications: 0,
        interviewApplications: 0,
        acceptanceRate: 0,
        conversionRate: 0,
        averageRating: 0,
        monthlyApplications: [],
        topSkills: [],
        activeInternships: 0,
        filledInternships: 0
      }
    });
  }
});


// Internships Management
app.get('/api/company/internships', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.user_type;
        
        // Verify user is a company
        if (userType !== 'company') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Companies only.'
            });
        }
        
        // Get internships for this company
        const [internships] = await db.execute(
            `SELECT i.*, 
                (SELECT COUNT(*) FROM student_internships WHERE internship_id = i.id) as applications_count,
                (SELECT COUNT(*) FROM student_internships WHERE internship_id = i.id AND status = 'pending') as pending_applications
            FROM internships i
            WHERE i.company_id = ?
            ORDER BY i.created_at DESC`,
            [userId]
        );
        
        // Parse required_skills from JSON
        const parsedInternships = internships.map(internship => ({
            ...internship,
            required_skills: internship.required_skills ? JSON.parse(internship.required_skills) : []
        }));
        
        res.json({
            success: true,
            internships: parsedInternships
        });
        
    } catch (error) {
        console.error('🔥 Error fetching company internships:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching internships'
        });
    }
});

app.get('/api/company/internships/:id', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const userId = req.user.id;
    const internshipId = req.params.id;

    const [internships] = await db.execute(
      `SELECT * FROM internships 
       WHERE id = ? AND company_id = ?`,
      [internshipId, userId]
    );

    if (internships.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Internship not found'
      });
    }

    const internship = internships[0];
    
    // Parse required_skills
    if (internship.required_skills) {
      try {
        internship.required_skills = JSON.parse(internship.required_skills);
      } catch (e) {
        internship.required_skills = [];
      }
    }

    res.json({
      success: true,
      internship
    });

  } catch (error) {
    console.error('🔥 Error fetching internship:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching internship'
    });
  }
});

app.post('/api/company/internships', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const userId = req.user.id;
        const userType = req.user.user_type;
        
        // Verify user is a company
        if (userType !== 'company') {
            await connection.rollback();
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Access denied. Companies only.'
            });
        }
        
        const {
            title,
            description,
            location,
            type,
            duration,
            stipend,
            stipend_type,
            required_skills,
            requirements,
            benefits,
            deadline,
            positions_available
        } = req.body;
        
        // Validate required fields
        if (!title || !description || !location || !type) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Title, description, location, and type are required'
            });
        }
        
        // Create internship
        const [result] = await connection.execute(
            `INSERT INTO internships 
            (company_id, title, description, location, type, duration, stipend, 
             stipend_type, required_skills, requirements, benefits, deadline, positions_available, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                userId,
                title,
                description,
                location,
                type,
                duration || null,
                stipend || 0,
                stipend_type || 'fixed',
                required_skills ? JSON.stringify(required_skills) : null,
                requirements || null,
                benefits || null,
                deadline || null,
                positions_available || 1
            ]
        );

        // ✅✅✅ Add database notifications (without Socket.io) ✅✅✅
        
        // 1. Get company name
        const [company] = await connection.execute(
            'SELECT company_name FROM companies WHERE user_id = ?',
            [userId]
        );
        
        const companyName = company[0]?.company_name || 'New Company';
        
        // 2. Get all registered students
        const [students] = await connection.execute(
            'SELECT id FROM users WHERE user_type = "student" AND is_verified = 1',
            []
        );
        
        console.log(`📢 Sending notification to ${students.length} student(s) about new internship: ${title}`);
        
       // 3. Save notifications in database for each student
for (const student of students) {
    await connection.execute(
        `INSERT INTO notifications 
         (user_id, type, title, message, is_read) 
         VALUES (?, 'new_internship', ?, ?, 0)`,
        [
            student.id,
            '📢 New Internship Available!',
            `${companyName} has posted a new internship: "${title}" in ${type} field. Apply now!`,
        ]
    );
}
        
        // 4. Notification for admin (optional)
        await connection.execute(
            `INSERT INTO admin_notifications 
             (type, title, message, company_id, internship_id, created_at) 
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [
                'new_internship',
                '📋 New Internship Posted',
                `${companyName} posted a new internship: ${title}`,
                userId,
                result.insertId
            ]
        );
        
        await connection.commit();
        connection.release();
        
        console.log('✅ Internship created:', {
            company_id: userId,
            internship_id: result.insertId,
            title: title
        });
        
        res.json({
            success: true,
            message: 'Internship created successfully!',
            internship_id: result.insertId
        });
        
    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Error creating internship:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating internship',
            error: error.message
        });
    }
});


app.put('/api/company/internships/:id', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    if (req.user.user_type !== 'company') {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const userId = req.user.id;
    const internshipId = req.params.id;
    const {
      title,
      description,
      location,
      type,
      duration,
      stipend,
      stipend_type,
      required_skills,
      requirements,
      benefits,
      deadline,
      positions_available,
      status
    } = req.body;

    // Verify ownership
    const [check] = await connection.execute(
      'SELECT id FROM internships WHERE id = ? AND company_id = ?',
      [internshipId, userId]
    );

    if (check.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Internship not found or unauthorized'
      });
    }

    // Build update query
    const updateFields = [];
    const updateValues = [];

    if (title) {
      updateFields.push('title = ?');
      updateValues.push(title);
    }
    if (description) {
      updateFields.push('description = ?');
      updateValues.push(description);
    }
    if (location) {
      updateFields.push('location = ?');
      updateValues.push(location);
    }
    if (type) {
      updateFields.push('type = ?');
      updateValues.push(type);
    }
    if (duration !== undefined) {
      updateFields.push('duration = ?');
      updateValues.push(duration || null);
    }
    if (stipend !== undefined) {
      updateFields.push('stipend = ?');
      updateValues.push(stipend || 0);
    }
    if (stipend_type) {
      updateFields.push('stipend_type = ?');
      updateValues.push(stipend_type);
    }
    if (required_skills) {
      updateFields.push('required_skills = ?');
      updateValues.push(JSON.stringify(required_skills));
    }
    if (requirements !== undefined) {
      updateFields.push('requirements = ?');
      updateValues.push(requirements || null);
    }
    if (benefits !== undefined) {
      updateFields.push('benefits = ?');
      updateValues.push(benefits || null);
    }
    if (deadline !== undefined) {
      updateFields.push('deadline = ?');
      updateValues.push(deadline || null);
    }
    if (positions_available) {
      updateFields.push('positions_available = ?');
      updateValues.push(positions_available);
    }
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(internshipId);

    if (updateFields.length > 0) {
      await connection.execute(
        `UPDATE internships SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Internship updated successfully'
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('🔥 Error updating internship:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating internship'
    });
  }
});


app.delete('/api/company/internships/:id', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    console.log('🗑️ Attempting to delete internship:', req.params.id);
    
    // Verify user is company
    if (req.user.user_type !== 'company') {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const userId = req.user.id;
    const internshipId = req.params.id;

    // 1️⃣ Verify ownership
    const [check] = await connection.execute(
      'SELECT id, title FROM internships WHERE id = ? AND company_id = ?',
      [internshipId, userId]
    );

    if (check.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Internship not found or unauthorized'
      });
    }

    console.log('✅ Found internship:', check[0].title);

    // 2️⃣ Check for related applications
    const [applications] = await connection.execute(
      'SELECT COUNT(*) as count FROM student_internships WHERE internship_id = ?',
      [internshipId]
    );
    
    console.log(`📊 Found ${applications[0].count} related applications`);

    // 3️⃣ Check for saved by students
    const [saved] = await connection.execute(
      'SELECT COUNT(*) as count FROM saved_internships WHERE internship_id = ?',
      [internshipId]
    );
    
    console.log(`📊 Found ${saved[0].count} students saved this internship`);

    // 4️⃣ إذا كان هناك متقدمين OR محفوظ، امنع الحذف
    if (applications[0].count > 0 || saved[0].count > 0) {
      await connection.rollback();
      connection.release();
      
      let message = '';
      if (applications[0].count > 0 && saved[0].count > 0) {
        message = `This internship has ${applications[0].count} applications and is saved by ${saved[0].count} students. It cannot be deleted. You can close it instead.`;
      } else if (applications[0].count > 0) {
        message = `This internship has ${applications[0].count} applications and cannot be deleted. You can close it instead.`;
      } else if (saved[0].count > 0) {
        message = `This internship is saved by ${saved[0].count} students and cannot be deleted. You can close it instead.`;
      }
      
      return res.status(400).json({
        success: false,
        message: message,
        canClose: true,
        applicationsCount: applications[0].count,
        savedCount: saved[0].count
      });
    }

    // 5️⃣ إذا لا يوجد متقدمين ولا محفوظ، احذف التدريب
    const [result] = await connection.execute(
      'DELETE FROM internships WHERE id = ?',
      [internshipId]
    );
    
    console.log('✅ Internship deleted, affected rows:', result.affectedRows);

    await connection.commit();
    console.log('✅ Transaction committed successfully');
    
    res.json({
      success: true,
      message: 'Internship deleted successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('🔥 Error deleting internship:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting internship: ' + error.message
    });
  } finally {
    connection.release();
  }
});


app.put('/api/company/internships/:id/status', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const userId = req.user.id;
    const internshipId = req.params.id;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['active', 'inactive', 'filled', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const [result] = await db.execute(
      'UPDATE internships SET status = ? WHERE id = ? AND company_id = ?',
      [status, internshipId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Internship not found or unauthorized'
      });
    }

    res.json({
      success: true,
      message: `Internship status updated to ${status}`
    });

  } catch (error) {
    console.error('🔥 Error updating status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating status'
    });
  }
});


// Applications Management
app.get('/api/company/applications', protect, async (req, res) => {
    try {
        const companyUserId = req.user.id;
        const userType = req.user.user_type;
        
        // Verify user is a company
        if (userType !== 'company') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Companies only.'
            });
        }
        
        const { internship_id, status } = req.query;
        
        // Build query based on your schema
        let sql = `
            SELECT 
                si.id,
                si.status,
                si.applied_at,
                si.reviewed_at,
                si.feedback,
                si.interview_date,
                si.interview_time,
                si.interview_mode,
                s.user_id as student_user_id,
                s.first_name,
                s.last_name,
                s.university,
                s.specialization,
                s.year_of_study,
                s.skills,
                s.github_link,
                s.linkedin_link,
                s.phone,
                s.university_email,
                i.id as internship_id,
                i.title as internship_title,
                i.type as internship_type,
                i.location as internship_location
            FROM student_internships si
            JOIN internships i ON si.internship_id = i.id
            JOIN students s ON si.student_id = s.user_id
            WHERE i.company_id = ?
        `;
        
        const params = [companyUserId];
        
        if (internship_id) {
            sql += ' AND i.id = ?';
            params.push(internship_id);
        }
        
        if (status) {
            sql += ' AND si.status = ?';
            params.push(status);
        }
        
        sql += ' ORDER BY si.applied_at DESC';
        
        const [applications] = await db.execute(sql, params);
        
        // Parse skills from JSON
        const parsedApplications = applications.map(app => ({
            ...app,
            skills: app.skills ? (typeof app.skills === 'string' ? JSON.parse(app.skills) : app.skills) : [],
            full_name: `${app.first_name} ${app.last_name}`,
            email: app.university_email || app.email
        }));
        
        res.json({
            success: true,
            applications: parsedApplications
        });
        
    } catch (error) {
        console.error('🔥 Error fetching company applications:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching applications',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});


app.get('/api/company/applications/:id', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    const applicationId = req.params.id;

    const [applications] = await db.execute(`
      SELECT 
        si.id,
        si.status,
        si.applied_at,
        si.reviewed_at,
        si.feedback,
        si.interview_date,
        si.interview_time,
        si.interview_mode,
        si.meeting_link,
        s.user_id as student_user_id,
        s.first_name,
        s.last_name,
        s.university,
        s.specialization,
        s.year_of_study,
        s.skills,
        s.phone,
        s.github_link,
        s.linkedin_link,
        s.bio,
        u.email as student_email,
        i.id as internship_id,
        i.title as internship_title,
        i.description,
        i.location,
        i.type,
        i.duration,
        i.stipend
      FROM student_internships si
      JOIN students s ON si.student_id = s.user_id
      JOIN users u ON s.user_id = u.id
      JOIN internships i ON si.internship_id = i.id
      WHERE si.id = ? AND i.company_id = ?
    `, [applicationId, companyId]);

    if (applications.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Application not found' 
      });
    }

    const application = applications[0];
    
    // Parse skills
    if (application.skills) {
      try {
        application.skills = JSON.parse(application.skills);
      } catch (e) {
        application.skills = [];
      }
    }

    res.json({
      success: true,
      application: {
        ...application,
        student_name: `${application.first_name} ${application.last_name}`
      }
    });

  } catch (error) {
    console.error('🔥 Error fetching application:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching application details',
      error: error.message 
    });
  }
});

app.put('/api/company/applications/:applicationId/status', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const companyUserId = req.user.id;
        const userType = req.user.user_type;
        const applicationId = req.params.applicationId;
        const { status, feedback, interview_date, interview_time, interview_mode, meeting_link } = req.body;
        
        // تحقق من أن المستخدم شركة
        if (userType !== 'company') {
            await connection.rollback();
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Access denied. Companies only.'
            });
        }
        
        // التحقق من صحة الحالة
        const validStatuses = ['pending', 'reviewed', 'interview', 'accepted', 'rejected'];
        if (!validStatuses.includes(status)) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }
        
        // جلب بيانات التقديم
        const [applications] = await connection.execute(
            `SELECT 
                si.*, 
                i.title as internship_title,
                i.company_id,
                c.company_name,
                s.user_id as student_id,
                s.first_name,
                s.last_name
            FROM student_internships si
            JOIN internships i ON si.internship_id = i.id
            JOIN companies c ON i.company_id = c.user_id
            JOIN students s ON si.student_id = s.user_id
            WHERE si.id = ? AND i.company_id = ?`,
            [applicationId, companyUserId]
        );
        
        if (applications.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Application not found'
            });
        }
        
        const application = applications[0];
        const currentCompanyId = application.company_id; // ✅ استخدم هذا
        
        // ============================================
        // ✅ التحقق من قبول الطالب (لحالة ACCEPTED فقط)
        // ============================================
        if (status === 'accepted') {
            
            // ============================================
            // 1️⃣ التحقق من قبول في شركة مختلفة (وليس نفس الشركة)
            // ============================================
            const [existingOtherCompany] = await connection.execute(
                `SELECT si.id, i.title, i.company_id, c.company_name, i.deadline, i.duration,
                        DATE_ADD(si.created_at, INTERVAL i.duration MONTH) as expected_end_date
                 FROM student_internships si
                 JOIN internships i ON si.internship_id = i.id
                 JOIN companies c ON i.company_id = c.user_id
                 WHERE si.student_id = ? 
                 AND si.status = 'accepted'
                 AND (si.is_validated = 0 OR si.is_validated IS NULL OR si.is_validated = FALSE)
                 AND i.company_id != ?
                 AND (i.deadline IS NULL OR i.deadline > NOW())`,
                [application.student_id, currentCompanyId]
            );
            
            if (existingOtherCompany.length > 0) {
                const existing = existingOtherCompany[0];
                const deadlineDate = new Date(existing.deadline);
                const now = new Date();
                
                if (deadlineDate > now) {
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        success: false,
                        message: `❌ This student has already been accepted by "${existing.company_name}" for the internship "${existing.title}". They cannot be accepted by another company until this deadline passes.`
                    });
                } else {
                    console.log(`⚠️ Previous acceptance deadline (${existing.deadline}) has passed. Allowing new acceptance.`);
                    
                    // تحديث حالة القبول السابق إلى "expired"
                    await connection.execute(
                        `UPDATE student_internships 
                         SET status = 'expired', feedback = 'Offer expired: deadline passed'
                         WHERE student_id = ? AND status = 'accepted' AND is_validated = 0 AND i.company_id != ?`,
                        [application.student_id, currentCompanyId]
                    );
                }
            }
            
            // ============================================
            // 2️⃣ التحقق من وجود تدريب نشط في نفس الشركة
            // ============================================
            const [activeSameCompany] = await connection.execute(
                `SELECT si.id, i.title, i.duration,
                        DATE_ADD(si.created_at, INTERVAL i.duration MONTH) as expected_end_date
                 FROM student_internships si
                 JOIN internships i ON si.internship_id = i.id
                 WHERE si.student_id = ? 
                 AND si.status = 'accepted'
                 AND si.is_validated = 0
                 AND i.company_id = ?
                 ORDER BY si.created_at DESC`,
                [application.student_id, currentCompanyId]
            );
            
            if (activeSameCompany.length > 0) {
                const existing = activeSameCompany[0];
                const endDate = new Date(existing.expected_end_date);
                const today = new Date();
                
                if (endDate > today) {
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        success: false,
                        message: `⚠️ This student is already accepted for "${existing.title}" at your company. This internship ends on ${endDate.toLocaleDateString()}. You can accept a new offer after completing the current internship.`
                    });
                }
                console.log(`✅ Previous internship ended. Allowing new acceptance.`);
            }
            
            // 3️⃣ التحقق من أن الموعد النهائي للتدريب الحالي لم ينته
            const [currentInternship] = await connection.execute(
                'SELECT deadline, title FROM internships WHERE id = ?',
                [application.internship_id]
            );
            
            if (currentInternship[0]?.deadline && new Date(currentInternship[0].deadline) < new Date()) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: `❌ Cannot accept student. The application deadline for "${currentInternship[0].title}" has passed.`
                });
            }
            
            // 4️⃣ التحقق من أن الطالب لم يتم قبوله بالفعل لهذا التدريب المحدد
            const [duplicateAcceptance] = await connection.execute(
                `SELECT id FROM student_internships 
                 WHERE student_id = ? AND internship_id = ? AND status = 'accepted'`,
                [application.student_id, application.internship_id]
            );
            
            if (duplicateAcceptance.length > 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: `❌ This student has already been accepted for this internship.`
                });
            }
        }
        
        // تحديث الحالة
        let updateQuery = 'UPDATE student_internships SET status = ?, feedback = ?, updated_at = NOW()';
        const params = [status, feedback || null];

        if (status === 'interview') {
            updateQuery += ', interview_date = ?, interview_time = ?, interview_mode = ?, meeting_link = ?';
            params.push(interview_date || null);
            params.push(interview_time || null);
            params.push(interview_mode || 'online');
            params.push(meeting_link || null);
        }

        updateQuery += ' WHERE id = ?';
        params.push(applicationId);

        await connection.execute(updateQuery, params);


        // ============================================
// ✅ INTERVIEW HANDLING (إنشاء إشعار المقابلة)
// ============================================
if (status === 'interview') {
    console.log('🎯 Scheduling interview, creating notification...');
    
    const interviewDateFormatted = interview_date ? new Date(interview_date).toLocaleDateString() : 'TBD';
    const interviewTimeFormatted = interview_time || 'TBD';
    
    // إشعار للطالب
    await connection.execute(
        `INSERT INTO notifications 
         (user_id, type, title, message, application_id, created_at) 
         VALUES (?, 'interview', ?, ?, ?, NOW())`,
        [
            application.student_id,
            '🎯 Interview Scheduled',
            `An interview has been scheduled for "${application.internship_title}" at ${application.company_name} on ${interviewDateFormatted} at ${interviewTimeFormatted}. Mode: ${interview_mode || 'online'}`,
            applicationId
        ]
    );
    console.log('✅ Interview notification created for student:', application.student_id);
    
    // إشعار للشركة
    await connection.execute(
        `INSERT INTO company_notifications 
         (company_id, type, title, message, application_id, created_at) 
         VALUES (?, 'interview', ?, ?, ?, NOW())`,
        [
            application.company_id,
            '🎯 Interview Scheduled',
            `You have scheduled an interview with ${application.first_name} ${application.last_name} for "${application.internship_title}" on ${interviewDateFormatted} at ${interviewTimeFormatted}.`,
            applicationId
        ]
    );
    console.log('✅ Company notification created for interview');
}
        
        // ========== إنشاء إشعارات الرفض ==========
        if (status === 'rejected') {
            console.log('\n' + '🔥'.repeat(30));
            console.log('🔥 REJECTION NOTIFICATION - COMPANY REJECT');
            console.log('🔥'.repeat(30));
            
            const reason = feedback || 'No specific reason provided';
            
            const title = '❌ Application Not Accepted';
            const message = `Your application for "${application.internship_title}" at ${application.company_name} was not selected.\n\nReason: ${reason}`;
            
            console.log('📌 Student ID:', application.student_id);
            console.log('📌 Title:', title);
            console.log('📌 Message:', message);
            
            try {
                const [notifResult] = await connection.execute(
                    `INSERT INTO notifications 
                    (user_id, type, title, message, application_id, is_read, created_at) 
                    VALUES (?, 'rejection', ?, ?, ?, 0, NOW())`,
                    [application.student_id, title, message, applicationId]
                );
                
                console.log('✅ NOTIFICATION CREATED! ID:', notifResult.insertId);
                
            } catch (notifError) {
                console.error('❌ ERROR CREATING NOTIFICATION:', notifError.message);
            }
            
            console.log('🔥'.repeat(30) + '\n');
        }
        
        // ============================================
        // ✅ ACCEPTED HANDLING (إنشاء الإشعارات)
        // ============================================
        if (status === 'accepted') {
            console.log('✅ Company accepted student, creating admin notification...');
            
            // إشعار للأدمن
            const [result] = await connection.execute(
                `INSERT INTO admin_notifications 
                 (type, title, message, company_id, student_id, internship_id, application_id, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    'company_accept',
                    '📋 New Acceptance Pending Validation',
                    `${application.company_name} has accepted ${application.first_name} ${application.last_name} for "${application.internship_title}" internship. Please validate.`,
                    application.company_id,
                    application.student_id,
                    application.internship_id,
                    applicationId
                ]
            );
            console.log('✅ Admin notification created with ID:', result.insertId);
            
            // إشعار للطالب
            await connection.execute(
                `INSERT INTO notifications 
                 (user_id, type, title, message, application_id, created_at) 
                 VALUES (?, 'acceptance', ?, ?, ?, NOW())`,
                [
                    application.student_id,
                    '🎉 Application Accepted!',
                    `Congratulations! ${application.company_name} has accepted your application for "${application.internship_title}". Your acceptance is pending admin validation.`,
                    applicationId
                ]
            );
            console.log('✅ Student notification created');
        }

        // جلب البيانات المحدثة لإرجاعها للفرونت إند
        const [updatedApps] = await connection.execute(
            `SELECT 
                si.*, 
                i.title as internship_title,
                i.location as internship_location,
                i.type as internship_type,
                i.duration,
                i.stipend,
                c.company_name,
                c.company_email as company_email
            FROM student_internships si
            JOIN internships i ON si.internship_id = i.id
            JOIN companies c ON i.company_id = c.user_id
            WHERE si.id = ?`,
            [applicationId]
        );
        
        await connection.commit();
        connection.release();
        
        console.log('✅ Application status updated:', {
            application_id: applicationId,
            new_status: status,
            company_id: companyUserId
        });
        
        res.json({
            success: true,
            message: 'Application status updated successfully',
            application: updatedApps[0]
        });
        
    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Error updating application status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating application status',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

app.put('/api/company/applications/:id/status', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback, interview_date, interview_time, interview_mode, meeting_link } = req.body;
    
    console.log('📝 Updating application:', { id, status, interview_date, interview_time, interview_mode });
    
    // بناء استعلام التحديث
    let query = 'UPDATE student_internships SET status = ?, updated_at = NOW()';
    const params = [status];
    
    // إذا كانت الحالة interview، قم بتحديث حقول المقابلة
    if (status === 'interview') {
      query += ', interview_date = ?, interview_time = ?, interview_mode = ?, meeting_link = ?';
      params.push(interview_date || null);
      params.push(interview_time || null);
      params.push(interview_mode || 'online');
      params.push(meeting_link || null);
    }
    
    // إذا كان هناك feedback
    if (feedback) {
      query += ', feedback = ?';
      params.push(feedback);
    }
    
    query += ' WHERE id = ?';
    params.push(id);
    
    console.log('📝 Executing query:', query, params);
    
    const [result] = await db.execute(query, params);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    
    // جلب البيانات المحدثة
    const [updatedApp] = await db.execute(
      'SELECT * FROM student_internships WHERE id = ?',
      [id]
    );
    
    res.json({ 
      success: true, 
      message: 'Status updated successfully',
      application: updatedApp[0]
    });
    
  } catch (error) {
    console.error('❌ Error updating status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});



// Agreements
app.get('/api/company/agreements', protect, async (req, res) => {
  try {
    // التحقق من أن المستخدم شركة
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id; // companyId = 4
    
    console.log(`🔍 Fetching agreements for company: ${companyId}`);
    
    // ✅ استعلام صحيح - يجلب كل اتفاقيات الشركة
    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.generated_at,
        a.sent_at,
        a.signed_at,
        a.archived_at,
        a.pdf_url,
        a.university_name,
        a.created_at,
        a.student_signed,
        a.company_signed,
        a.university_signed,        -- ✅ أضف هذا (توقيع الجامعة)
        a.company_signed_at,        -- ✅ أضف هذا (تاريخ توقيع الشركة)
        a.university_signed_at,     -- ✅ أضف هذا (تاريخ توقيع الجامعة)
        a.completed_at,              -- ✅ أضف هذا (تاريخ الاكتمال)
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.first_name,
        s.last_name,
        s.university,
        u.email as student_email,
        i.title as internship_title,
        i.description,
        i.duration,
        i.stipend,
        i.location,
        i.type as internship_type,
        c.company_name
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      JOIN users u ON s.user_id = u.id
      WHERE i.company_id = ?  -- company_id = 4
      ORDER BY a.created_at DESC
    `, [companyId]);

    console.log(`✅ Found ${agreements.length} agreements for company ${companyId}`);
    
    res.json({
      success: true,
      agreements
    });

  } catch (error) {
    console.error('🔥 Error fetching company agreements:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching agreements',
      error: error.message 
    });
  }
});


app.get('/api/company/agreements/:agreementId', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    const agreementId = req.params.agreementId;
    
    console.log(`🔍 Company ${companyId} fetching agreement ${agreementId}`);
    
    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.generated_at,
        a.sent_at,
        a.signed_at,
        a.archived_at,
        a.pdf_url,
        a.university_name,
        a.created_at,
        a.student_signed,
        a.company_signed,
        a.university_signed,
        a.signature_url,
        a.company_signature_url,
        a.university_signature_url,
        a.company_signed_at,        -- ✅ أضف هذا
        a.university_signed_at,     -- ✅ أضف هذا
        a.completed_at,              -- ✅ أضف هذا
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.first_name,
        s.last_name,
        s.university,
        u.email as student_email,
        i.title as internship_title,
        i.description,
        i.duration,
        i.stipend,
        i.location,
        i.type as internship_type,
        c.company_name
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      JOIN users u ON s.user_id = u.id
      WHERE a.id = ? AND i.company_id = ?
    `, [agreementId, companyId]);

    if (agreements.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }

    res.json({
      success: true,
      agreement: agreements[0]
    });

  } catch (error) {
    console.error('🔥 Error fetching agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching agreement',
      error: error.message 
    });
  }
});


app.get('/api/company/agreements/:agreementId/download', protect, async (req, res) => {
  try {
    const companyId = req.user.id;
    const agreementId = req.params.agreementId;
    
    const [agreements] = await db.execute(`
      SELECT 
        a.*,
        i.title as internship_title,
        i.duration,
        i.stipend,
        i.start_date as internship_start_date,
        i.end_date as internship_end_date,
        s.first_name,
        s.last_name,
        s.university,
        s.student_id,
        s.phone as student_phone,
        s.social_security,
        s.academic_supervisor,
        c.company_name,
        c.address as company_address,
        c.contact_person as company_representative,
        c.phone as company_phone
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      WHERE a.id = ? AND i.company_id = ?
    `, [agreementId, companyId]);
    
    if (agreements.length === 0) {
      return res.status(404).json({ success: false, message: 'Agreement not found' });
    }
    
    const agreement = agreements[0];
    
    // ✅ حساب end_date تلقائياً إذا كان NULL
    let startDateValue = agreement.internship_start_date || agreement.created_at;
    let endDateValue = agreement.internship_end_date || '';
    
    if (!endDateValue && agreement.duration) {
      const start = new Date(startDateValue);
      const end = new Date(start);
      end.setMonth(end.getMonth() + (parseInt(agreement.duration) || 3));
      endDateValue = end.toISOString().split('T')[0];
      console.log('✅ Auto-calculated end_date for company:', endDateValue);
    }
    
    const pdfData = {
      studentName: `${agreement.first_name} ${agreement.last_name}`,
      companyName: agreement.company_name,
      companyAddress: agreement.company_address,
      companyRepresentative: agreement.company_representative,
      companyPhone: agreement.company_phone,
      studentId: agreement.student_id,
      socialSecurity: agreement.social_security,
      studentPhone: agreement.student_phone,
      internshipTitle: agreement.internship_title,
      supervisor: agreement.academic_supervisor,
      duration: agreement.duration,
      startDate: startDateValue,
      endDate: endDateValue,
      studentSignature: agreement.signature_url,
      companySignature: agreement.company_signature_url,
      universitySignature: agreement.university_signature_url
    };
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=convention_stage_${agreement.first_name}_${agreement.last_name}.pdf`);
    
    await generateConventionDeStagePDF(pdfData, res);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


app.put('/api/company/agreements/:agreementId/sign', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const companyId = req.user.id;
    const agreementId = req.params.agreementId;
    const { signature, signature_type, typed_name } = req.body;
    
    console.log('\n' + '='.repeat(50));
    console.log('✍️ Company Signing Agreement with Signature');
    console.log('='.repeat(50));
    console.log('📌 Company ID:', companyId);
    console.log('📌 Agreement ID:', agreementId);
    console.log('📌 Signature Type:', signature_type);
    console.log('📌 Signature Received:', signature ? 'Yes ✓' : 'No ✗');
    console.log('='.repeat(50) + '\n');
    
    if (!signature) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Please add your company signature first' 
      });
    }
    
    const [agreements] = await connection.execute(
      `SELECT a.*, i.title, i.company_id, 
              s.user_id as student_id,
              CONCAT(s.first_name, ' ', s.last_name) as student_name,
              c.company_name
       FROM agreements a
       JOIN internships i ON a.internship_id = i.id
       JOIN companies c ON i.company_id = c.user_id
       JOIN students s ON a.student_id = s.user_id
       WHERE a.id = ? AND i.company_id = ?`,
      [agreementId, companyId]
    );
    
    if (agreements.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found or unauthorized' 
      });
    }
    
    const agreement = agreements[0];
    
    if (agreement.company_signed) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Agreement already signed by company' 
      });
    }
    
    // حفظ توقيع الشركة
    let signaturePath = null;
    if (signature) {
      const base64Data = signature.replace(/^data:image\/png;base64,/, '');
      const signatureFileName = `company_signature_${companyId}_${agreementId}_${Date.now()}.png`;
      const signatureFilePath = path.join(__dirname, 'uploads', 'signatures', signatureFileName);
      
      const signatureDir = path.join(__dirname, 'uploads', 'signatures');
      if (!fs.existsSync(signatureDir)) {
        fs.mkdirSync(signatureDir, { recursive: true });
      }
      
      fs.writeFileSync(signatureFilePath, base64Data, 'base64');
      signaturePath = `/uploads/signatures/${signatureFileName}`;
      console.log('✅ Company signature saved at:', signaturePath);
    }
    
    // ✅ تحديث مع company_signed_at
    await connection.execute(
      `UPDATE agreements 
       SET company_signed = 1,
           company_signature_url = ?,
           company_signature_type = ?,
           company_typed_name = ?,
           company_signed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [signaturePath, signature_type, typed_name || null, agreementId]
    );
    
    console.log('✅ Company signature updated in database');
    
    // التحقق من حالة التوقيعات
    const [updatedAgreement] = await connection.execute(
      'SELECT student_signed, company_signed, university_signed FROM agreements WHERE id = ?',
      [agreementId]
    );
    
    if (updatedAgreement[0].student_signed === 1 && updatedAgreement[0].company_signed === 1) {
    await connection.execute(
        'UPDATE agreements SET status = "signed", signed_at = NOW() WHERE id = ?',
        [agreementId]
    );
    console.log('✅ Agreement status updated to "signed" (student + company signed)');
}
    
    // إشعار للطالب
    await connection.execute(
      `INSERT INTO notifications 
       (user_id, type, title, message, agreement_id, created_at) 
       VALUES (?, 'agreement_signed', ?, ?, ?, NOW())`,
      [
        agreement.student_id,
        '📄 Company Signed Agreement',
        `${agreement.company_name} has signed the agreement for "${agreement.title}".`,
        agreementId
      ]
    );
    console.log('✅ Student notification created!');
    
    // إشعار للأدمن
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, company_id, student_id, agreement_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'agreement_signed',
        '📄 Company Signed Agreement',
        `${agreement.company_name} has signed the agreement with ${agreement.student_name}.`,
        companyId,
        agreement.student_id,
        agreementId
      ]
    );
    console.log('✅ Admin notification created!');
    
    await connection.commit();
    connection.release();
    
    console.log('✅ Company agreement signed successfully!\n');
    
    res.json({ 
      success: true, 
      message: '✅ Agreement signed successfully by company!' 
    });
    
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('🔥 Error signing agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error signing agreement: ' + error.message 
    });
  }
});


// Notifications
app.get('/api/company/notifications', protect, async (req, res) => {
  try {
    const companyId = req.user.id;
    
    const [notifications] = await db.execute(
      `SELECT * FROM company_notifications 
       WHERE company_id = ? 
       ORDER BY created_at DESC`,
      [companyId]
    );

    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error('Error fetching company notifications:', error);
    res.json({ success: true, notifications: [] });
  }
});


app.put('/api/company/notifications/:id/read', protect, async (req, res) => {
  try {
    // ✅ التحقق من أن المستخدم شركة
    if (req.user.user_type !== 'company') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Companies only.'
      });
    }

    const notificationId = req.params.id;
    const companyId = req.user.id;

    // ✅ التحقق من وجود الإشعار وتحديثه
    const [result] = await db.execute(
      'UPDATE company_notifications SET is_read = 1 WHERE id = ? AND company_id = ?',
      [notificationId, companyId]
    );

    // ✅ التحقق من نجاح التحديث
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // ✅ رسالة نجاح
    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('🔥 Error marking company notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification'
    });
  }
});


app.put('/api/company/notifications/read-all', protect, async (req, res) => {
  try {
    // ✅ التحقق من أن المستخدم شركة
    if (req.user.user_type !== 'company') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Companies only.'
      });
    }

    const companyId = req.user.id;

    // ✅ التحقق من وجود الشركة في جدول companies
    const [companyExists] = await db.execute(
      'SELECT id FROM companies WHERE user_id = ?',
      [companyId]
    );

    if (companyExists.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // ✅ تحديث جميع الإشعارات
    const [result] = await db.execute(
      'UPDATE company_notifications SET is_read = 1 WHERE company_id = ?',
      [companyId]
    );

    console.log(`✅ Marked ${result.affectedRows} company notifications as read for company ${companyId}`);

    // ✅ رسالة نجاح مع عدد الإشعارات المحدثة
    res.json({
      success: true,
      message: result.affectedRows > 0 
        ? `All notifications marked as read (${result.affectedRows} notifications)`
        : 'No unread notifications found',
      count: result.affectedRows
    });

  } catch (error) {
    console.error('🔥 Error marking all company notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking all notifications',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// Account Settings
app.put('/api/company/change-password', protect, async (req, res) => {
  console.log('\n🔐 === CHANGE COMPANY PASSWORD REQUEST ===');
  
  try {
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    const [users] = await db.execute(
      'SELECT password FROM users WHERE id = ?',
      [companyId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, users[0].password);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    const [updateResult] = await db.execute(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, companyId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('✅ Company password changed successfully');
    
    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('🔥 Error in change-password:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password: ' + error.message
    });
  }
});


app.delete('/api/company/account', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    if (req.user.user_type !== 'company') {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    const { password } = req.body;

    const [users] = await connection.execute(
      'SELECT password FROM users WHERE id = ?',
      [companyId]
    );

    if (users.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, users[0].password);
    
    if (!isPasswordValid) {
      await connection.rollback();
      connection.release();
      return res.status(401).json({
        success: false,
        message: 'Password is incorrect'
      });
    }

    // حذف جميع البيانات المرتبطة
    await connection.execute('DELETE FROM company_settings WHERE company_id = ?', [companyId]);
    await connection.execute('DELETE FROM internships WHERE company_id = ?', [companyId]);
    await connection.execute('DELETE FROM companies WHERE user_id = ?', [companyId]);
    await connection.execute('DELETE FROM users WHERE id = ?', [companyId]);

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Company account deleted successfully'
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('Error deleting company account:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting account'
    });
  }
});


app.get('/api/company/preferences', protect, async (req, res) => {
  try {
    // التحقق من أن المستخدم شركة
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    
    // الإعدادات الافتراضية للشركة
    const defaultSettings = {
      account: {
        emailNotifications: true,
        applicationUpdates: true,
        newApplicationAlerts: true,
        agreementAlerts: true,
        newsletter: false
      },
      privacy: {
        profileVisibility: 'public',
        showContactInfo: true,
        showInternships: true,
        allowStudentMessages: true,
        showCompanySize: true,
        showRating: true
      },
      preferences: {
        preferredStudentSkills: [],
        notificationFrequency: 'instant',
        language: 'en',
        theme: 'light',
        autoApproveApplications: false,
        internshipAutoExpire: 30
      }
    };

    // محاولة جلب الإعدادات من قاعدة البيانات
    try {
      const [settings] = await db.execute(
        'SELECT settings FROM company_settings WHERE company_id = ?',
        [companyId]
      );

      if (settings.length > 0 && settings[0].settings) {
        try {
          const settingsData = JSON.parse(settings[0].settings);
          return res.json({
            success: true,
            settings: settingsData
          });
        } catch (parseError) {
          console.error('Error parsing settings:', parseError);
        }
      }
    } catch (dbError) {
      if (dbError.code === 'ER_NO_SUCH_TABLE') {
        console.log('Table company_settings does not exist, creating...');
        await db.execute(`
          CREATE TABLE IF NOT EXISTS company_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            company_id INT NOT NULL UNIQUE,
            settings JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `);
      } else {
        console.error('Database error:', dbError);
      }
    }

    // إرجاع الإعدادات الافتراضية
    res.json({
      success: true,
      settings: defaultSettings
    });

  } catch (error) {
    console.error('Error fetching company preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching preferences'
    });
  }
});


app.put('/api/company/preferences', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();

    if (req.user.user_type !== 'company') {
      await connection.rollback();
      connection.release();
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const companyId = req.user.id;
    const settingsData = req.body;

    // التحقق من وجود الجدول
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'company_settings'"
    );

    if (tables.length === 0) {
      await connection.execute(`
        CREATE TABLE company_settings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          company_id INT NOT NULL UNIQUE,
          settings JSON,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    }

    // التحقق من وجود إعدادات مسبقة
    const [existing] = await connection.execute(
      'SELECT id FROM company_settings WHERE company_id = ?',
      [companyId]
    );

    if (existing.length > 0) {
      // تحديث الإعدادات الموجودة
      await connection.execute(
        'UPDATE company_settings SET settings = ?, updated_at = NOW() WHERE company_id = ?',
        [JSON.stringify(settingsData), companyId]
      );
    } else {
      // إدراج إعدادات جديدة
      await connection.execute(
        'INSERT INTO company_settings (company_id, settings) VALUES (?, ?)',
        [companyId, JSON.stringify(settingsData)]
      );
    }

    await connection.commit();
    connection.release();

    res.json({
      success: true,
      message: 'Company preferences saved successfully'
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('Error saving company preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving preferences'
    });
  }
});


// Company profile for rating
app.get('/api/company/profile/:companyId', protect, async (req, res) => {
  try {
    const companyId = req.params.companyId;
    
    console.log(`🔍 Fetching company profile for ID: ${companyId}`);
    
    const [companies] = await db.execute(
      `SELECT 
        c.user_id as id,
        c.company_name,
        c.logo_url,
        c.wilaya,
        c.description,
        c.average_rating
       FROM companies c
       WHERE c.user_id = ?`,
      [companyId]
    );

    if (companies.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    console.log(`✅ Found company: ${companies[0].company_name}`);
    
    res.json({
      success: true,
      profile: companies[0]
    });
  } catch (error) {
    console.error('❌ Error fetching company:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching company'
    });
  }
});



// 📋 INTERNSHIP ROUTES (Public/Shared)
app.get('/api/internships', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.user_type;
        
        // Only students and admins can view internships
        if (userType !== 'student' && userType !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Students only.'
            });
        }
        
        // Extract query parameters
        const {
            wilaya,
            technology,
            type,
            remote,
            search,
            duration,
            stipend,
            datePosted
        } = req.query;
        
        // Build SQL query with filters
        let sql = `
            SELECT 
                i.*,
                c.company_name,
                IF(si.id IS NOT NULL, TRUE, FALSE) as has_applied
            FROM internships i
            JOIN companies c ON i.company_id = c.user_id
            LEFT JOIN student_internships si ON i.id = si.internship_id AND si.student_id = ?
            WHERE i.status = 'active'
        `;
        
        const params = [userId];
        
        // Add filters dynamically
        if (wilaya) {
            sql += ' AND i.location = ?';
            params.push(wilaya);
        }
        
        if (technology) {
            sql += ' AND JSON_CONTAINS(i.required_skills, ?)';
            params.push(JSON.stringify(technology));
        }
        
        if (type) {
            sql += ' AND i.type = ?';
            params.push(type);
        }
        
        if (remote === 'true') {
            sql += ' AND i.type = "remote"';
        }
        
        if (search) {
            sql += ' AND (i.title LIKE ? OR i.description LIKE ? OR c.company_name LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        
        if (duration) {
            if (duration === '1-3') {
                sql += ' AND i.duration BETWEEN 1 AND 3';
            } else if (duration === '3-6') {
                sql += ' AND i.duration BETWEEN 3 AND 6';
            } else if (duration === '6+') {
                sql += ' AND i.duration >= 6';
            }
        }
        
        if (stipend) {
            if (stipend === 'paid') {
                sql += ' AND i.stipend > 0';
            } else if (stipend === 'unpaid') {
                sql += ' AND i.stipend = 0';
            } else if (stipend === 'negotiable') {
                sql += ' AND i.stipend_type = "negotiable"';
            }
        }
        
        if (datePosted) {
            const now = new Date();
            let startDate;
            
            if (datePosted === 'today') {
                startDate = new Date(now.setHours(0, 0, 0, 0));
            } else if (datePosted === 'week') {
                startDate = new Date(now.setDate(now.getDate() - 7));
            } else if (datePosted === 'month') {
                startDate = new Date(now.setMonth(now.getMonth() - 1));
            }
            
            if (startDate) {
                sql += ' AND i.created_at >= ?';
                params.push(startDate);
            }
        }
        
        sql += ' ORDER BY i.created_at DESC';
        
        console.log('🔍 Fetching internships with filters:', req.query);
        
        // Execute query
        const [internships] = await db.execute(sql, params);
        
        // Parse required_skills from JSON string to array
        const parsedInternships = internships.map(internship => ({
            ...internship,
            required_skills: internship.required_skills ? JSON.parse(internship.required_skills) : [],
            has_applied: Boolean(internship.has_applied)
        }));
        
        res.json({
            success: true,
            internships: parsedInternships
        });
        
    } catch (error) {
        console.error('🔥 Error fetching internships:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching internships',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});


app.get('/api/internships/:id', protect, async (req, res) => {
    console.log('🔍 ROUTE 26 called with ID:', req.params.id);
    
    try {
        const userId = req.user.id;
        const userType = req.user.user_type;
        const internshipId = req.params.id;

        await db.execute(
            'UPDATE internships SET views_count = views_count + 1 WHERE id = ?',
            [internshipId]
        );
        console.log(`✅ Views count increased for internship ${internshipId}`);
        
        console.log('User:', { userId, userType, internshipId });
        
        // Only students and admins can view internship details
        if (userType !== 'student' && userType !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Students only.'
            });
        }
        
        // Get internship with company details
        const [internships] = await db.execute(
            `SELECT 
                i.*,
                c.company_name,
                c.company_email,
                c.phone,
                c.website,
                c.wilaya as company_location,
                c.address as company_address,
                c.contact_person,
                c.description as company_description,
                IF(si.id IS NOT NULL, TRUE, FALSE) as has_applied,
                si.status as application_status
            FROM internships i
            JOIN companies c ON i.company_id = c.user_id
            LEFT JOIN student_internships si ON i.id = si.internship_id AND si.student_id = ?
            WHERE i.id = ? AND i.status = 'active'`,
            [userId, internshipId]
        );
        
        if (internships.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Internship not found'
            });
        }
        
        const internship = internships[0];
        
        // Parse required_skills from JSON
        internship.required_skills = internship.required_skills ? JSON.parse(internship.required_skills) : [];
        
        // Parse requirements and benefits if they are JSON
        try {
            internship.requirements = internship.requirements ? JSON.parse(internship.requirements) : [];
            internship.benefits = internship.benefits ? JSON.parse(internship.benefits) : [];
        } catch (e) {
            // If not JSON, keep as string
            internship.requirements = internship.requirements || '';
            internship.benefits = internship.benefits || '';
        }
        
        // Get similar internships
        const [similarInternships] = await db.execute(
            `SELECT 
                i.id,
                i.title,
                i.type,
                i.location,
                i.duration,
                i.stipend,
                c.company_name,
                c.wilaya as company_location
            FROM internships i
            JOIN companies c ON i.company_id = c.user_id
            WHERE i.id != ? 
            AND i.status = 'active'
            AND (i.type = ? OR i.location = ?)
            LIMIT 3`,
            [internshipId, internship.type, internship.location]
        );
        
        res.json({
            success: true,
            internship: internship,
            similarInternships: similarInternships
        });
        
    } catch (error) {
        console.error('🔥 Error fetching internship details:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching internship details',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});


app.get('/api/internships/:id/similar', protect, async (req, res) => {
  try {
    const internshipId = req.params.id;
    
    // جلب التدريب الحالي لمعرفة مهاراته
    const [internships] = await db.execute(
      `SELECT required_skills, type, location, duration FROM internships WHERE id = ?`,
      [internshipId]
    );
    
    if (internships.length === 0) {
      return res.json({ success: true, similar: [] });
    }
    
    const current = internships[0];
    let skills = [];
    
    if (current.required_skills) {
      try {
        skills = JSON.parse(current.required_skills);
      } catch (e) {
        skills = [];
      }
    }
    
    console.log('🔍 Searching for similar internships:', {
      type: current.type,
      location: current.location,
      skills: skills,
      duration: current.duration
    });
    
    // بناء شروط LIKE للمهارات (بديل JSON_OVERLAPS)
    let skillCondition = '';
    const queryParams = [internshipId];
    
    if (skills.length > 0) {
      const likeConditions = [];
      skills.forEach(skill => {
        likeConditions.push(`i.required_skills LIKE ?`);
        queryParams.push(`%${skill}%`);
      });
      skillCondition = ` OR (${likeConditions.join(' OR ')})`;
    }
    
    // استعلام بدون JSON_OVERLAPS - متوافق مع MySQL 5.7
    const [similar] = await db.execute(
      `SELECT 
        i.id,
        i.title,
        i.type,
        i.location,
        i.duration,
        i.stipend,
        i.description,
        i.required_skills,
        c.company_name
      FROM internships i
      JOIN companies c ON i.company_id = c.user_id
      WHERE i.id != ? 
        AND i.status = 'active'
        AND (
          i.type = ? 
          OR (i.location IS NOT NULL AND i.location LIKE ?)
          ${skillCondition}
          OR (i.duration IS NOT NULL AND i.duration BETWEEN ? AND ?)
        )
      LIMIT 3`,
      [
        internshipId, 
        current.type || '', 
        `%${current.location || ''}%`,
        ...queryParams.slice(1),
        Math.max(1, (current.duration || 3) - 1),
        (current.duration || 3) + 1
      ]
    );
    
    console.log(`✅ Found ${similar.length} similar internships`);
    
    // ============================================
    // 🔥 الكود الجديد: تنسيق المهارات وحساب درجة التشابه
    // ============================================
    const formatted = similar.map(item => {
      let score = 0;
      
      // تحويل المهارات من JSON إلى مصفوفة
      const itemSkills = item.required_skills ? JSON.parse(item.required_skills) : [];
      
      // نفس النوع = +3 نقاط
      if (item.type === current.type) score += 3;
      
      // نفس الموقع = +2 نقاط
      if (item.location === current.location) score += 2;
      
      // نفس المهارات = نقطة لكل مهارة مشتركة
      skills.forEach(skill => {
        if (itemSkills.includes(skill)) score += 1;
      });
      
      // نفس المدة = +1 نقطة
      if (item.duration === current.duration) score += 1;
      
      return { 
        ...item, 
        required_skills: itemSkills, 
        matchScore: score 
      };
    });
    
    // ترتيب حسب درجة التشابه (الأعلى أولاً)
    formatted.sort((a, b) => b.matchScore - a.matchScore);
    
    // طباعة درجة التشابه في الـ Console (للتصحيح)
    console.log('📊 Similar internships with scores:');
    formatted.forEach(item => {
      console.log(`   - ${item.title}: ${item.matchScore} points`);
    });
    
    res.json({
      success: true,
      similar: formatted
    });
    
  } catch (error) {
    console.error('🔥 Error fetching similar internships:', error);
    res.json({ success: true, similar: [] });
  }
});



// 👑 ADMIN ROUTES

// Company Management
app.get('/api/admin/pending-companies', protect, async (req, res) => {
    try {
        // Verify user is admin
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        // Get all companies with pending verification
        const [companies] = await db.execute(
            `SELECT u.id, u.email, u.created_at, 
                    c.company_name, c.contact_person, c.phone, 
                    c.trade_register, c.activity_sector, c.wilaya,
                    c.description
             FROM users u
             JOIN companies c ON u.id = c.user_id
             WHERE u.user_type = 'company' AND u.is_verified = 0
             ORDER BY u.created_at DESC`
        );

        res.json({
            success: true,
            companies: companies
        });

    } catch (error) {
        console.error('🔥 Error fetching pending companies:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching pending companies'
        });
    }
});



app.put('/api/admin/companies/:companyId/approve', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // Verify user is admin
        if (req.user.user_type !== 'admin') {
            await connection.rollback();
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        const companyId = req.params.companyId;

        // Check if company exists
        const [companies] = await connection.execute(
            `SELECT u.id, u.email, c.company_name 
             FROM users u
             JOIN companies c ON u.id = c.user_id
             WHERE u.id = ? AND u.user_type = 'company'`,
            [companyId]
        );

        if (companies.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        const company = companies[0];

        // Approve company (set is_verified = 1)
        await connection.execute(
            'UPDATE users SET is_verified = 1 WHERE id = ?',
            [companyId]
        );

        // Send notification to company
        await connection.execute(
            `INSERT INTO company_notifications 
            (company_id, type, title, message, created_at) 
            VALUES (?, ?, ?, ?, NOW())`,
            [
                companyId,
                'approval',
                '✅ Your Company Account Has Been Approved',
                `Congratulations! Your company "${company.company_name}" has been verified. You can now post internships and access all features.`
            ]
        );

        // Update admin notification
        await connection.execute(
            `UPDATE admin_notifications 
             SET is_read = 1, data = JSON_SET(IFNULL(data, '{}'), '$.approved', TRUE)
             WHERE JSON_EXTRACT(data, '$.company_id') = ?`,
            [companyId]
        );

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: `Company "${company.company_name}" has been approved successfully`
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Error approving company:', error);
        res.status(500).json({
            success: false,
            message: 'Error approving company'
        });
    }
});


app.delete('/api/admin/companies/:companyId/reject', protect, async (req, res) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // Verify user is admin
        if (req.user.user_type !== 'admin') {
            await connection.rollback();
            connection.release();
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        const companyId = req.params.companyId;
        const { reason } = req.body;

        // Get company info before deletion
        const [companies] = await connection.execute(
            `SELECT u.email, c.company_name 
             FROM users u
             JOIN companies c ON u.id = c.user_id
             WHERE u.id = ?`,
            [companyId]
        );

        if (companies.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        const company = companies[0];

        // Delete company (cascade will delete from users table)
        await connection.execute(
            'DELETE FROM users WHERE id = ?',
            [companyId]
        );

        // يمكن إرسال إيميل للشركة المرفوضة (اختياري)
        // await sendRejectionEmail(company.email, company.company_name, reason);

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: `Company "${company.company_name}" has been rejected and removed`
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        
        console.error('🔥 Error rejecting company:', error);
        res.status(500).json({
            success: false,
            message: 'Error rejecting company'
        });
    }
});


app.get('/api/admin/companies', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin only' });
        }

        const [companies] = await db.execute(`
            SELECT 
                c.id as id,
                u.id as user_id,
                u.email, 
                u.is_verified,
                u.is_suspended,
                c.company_name, 
                c.contact_person, 
                c.phone, 
                c.trade_register, 
                c.activity_sector, 
                c.company_size,
                c.wilaya,
                c.address,
                c.description,
                c.logo_url,
                (SELECT COUNT(*) FROM internships WHERE company_id = u.id) as internships_count
            FROM users u
            JOIN companies c ON u.id = c.user_id
            WHERE u.user_type = 'company'
            ORDER BY u.created_at DESC
        `);

        // ✅ إضافة verification_status
        const companiesWithStatus = companies.map(company => {
            let verification_status = 'pending';
            
            if (company.is_archived === 1) {
                verification_status = 'archived';
            } else if (company.is_suspended === 1) {
                verification_status = 'suspended';
            } else if (company.is_verified === 1) {
                verification_status = 'verified';
            }
            
            return {
                id: company.id,
                user_id: company.user_id,
                email: company.email,
                company_name: company.company_name,
                is_verified: company.is_verified,
                is_suspended: company.is_suspended,
                is_archived: company.is_archived,
                verification_status: verification_status,
                internships_count: company.internships_count,
                wilaya: company.wilaya,
                logo_url: company.logo_url
            };
        });

        console.log('📊 Companies with status:', companiesWithStatus);

        res.json({ success: true, companies: companiesWithStatus });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


app.put('/api/admin/companies/:id/suspend', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin only' });
        }

        const companyId = req.params.id;
        
        const [company] = await db.execute(
            'SELECT user_id FROM companies WHERE id = ?',
            [companyId]
        );

        if (company.length === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        await db.execute(
            'UPDATE users SET is_suspended = 1 WHERE id = ?',
            [company[0].user_id]
        );

        res.json({ success: true, message: 'Company suspended successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});



app.put('/api/admin/companies/:id/verify', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin only' });
        }

        const companyId = req.params.id;
        
        const [company] = await db.execute(
            'SELECT user_id FROM companies WHERE id = ?',
            [companyId]
        );

        if (company.length === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        await db.execute(
            'UPDATE users SET is_verified = 1, is_suspended = 0 WHERE id = ?',
            [company[0].user_id]
        );

        res.json({ success: true, message: 'Company verified successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


app.get('/api/admin/companies/:id', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const companyId = req.params.id;

    const [companies] = await db.execute(`
      SELECT 
        u.id, u.email, u.is_verified, u.is_suspended, u.created_at,
        c.company_name, c.contact_person, c.phone, c.website,
        c.trade_register, c.activity_sector, c.company_size,
        c.wilaya, c.address, c.description, c.logo_url, c.cover_image_url,
        CASE 
          WHEN u.is_verified = 0 THEN 'pending'
          WHEN u.is_suspended = 1 THEN 'suspended'
          ELSE 'verified'
        END as verification_status
      FROM users u
      JOIN companies c ON u.id = c.user_id
      WHERE u.id = ? AND u.user_type = 'company'
    `, [companyId]);

    if (companies.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    res.json({ success: true, company: companies[0] });

  } catch (error) {
    console.error('Error fetching company:', error);
    res.status(500).json({ success: false, message: 'Error fetching company' });
  }
});


app.get('/api/admin/companies/:id/internships', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const companyId = req.params.id;

    const [internships] = await db.execute(`
      SELECT 
        i.*,
        (SELECT COUNT(*) FROM student_internships WHERE internship_id = i.id) as applications_count
      FROM internships i
      WHERE i.company_id = ?
      ORDER BY i.created_at DESC
    `, [companyId]);

    // Parse required_skills
    const parsedInternships = internships.map(internship => ({
      ...internship,
      required_skills: internship.required_skills ? JSON.parse(internship.required_skills) : []
    }));

    res.json({ success: true, internships: parsedInternships });

  } catch (error) {
    console.error('Error fetching internships:', error);
    res.status(500).json({ success: false, message: 'Error fetching internships' });
  }
});


app.get('/api/admin/companies/:id/applications', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const companyId = req.params.id;

    const [applications] = await db.execute(`
      SELECT 
        si.id, si.status, si.applied_at,
        i.title as internship_title,
        CONCAT(s.first_name, ' ', s.last_name) as student_name
      FROM student_internships si
      JOIN internships i ON si.internship_id = i.id
      JOIN students s ON si.student_id = s.user_id
      WHERE i.company_id = ?
      ORDER BY si.applied_at DESC
      LIMIT 20
    `, [companyId]);

    res.json({ success: true, applications });

  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ success: false, message: 'Error fetching applications' });
  }
});


// Dashboard Stats
app.get('/api/admin/stats', protect, async (req, res) => {
    try {
        // Verify user is admin
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        // 1️⃣ إجمالي الشركات
        const [totalCompanies] = await db.execute(
            'SELECT COUNT(*) as count FROM users WHERE user_type = "company"'
        );
        
        // 2️⃣ إجمالي الطلاب
        const [totalStudents] = await db.execute(
            'SELECT COUNT(*) as count FROM users WHERE user_type = "student"'
        );
        
        // 3️⃣ إجمالي التدريبات
        const [totalInternships] = await db.execute(
            'SELECT COUNT(*) as count FROM internships'
        );
        
        // 4️⃣ الشركات المنتظرة
        const [pendingCompanies] = await db.execute(
            'SELECT COUNT(*) as count FROM users WHERE user_type = "company" AND is_verified = 0'
        );
        
        // 5️⃣ الاتفاقيات المنتظرة
const [pendingAgreements] = await db.execute(
    'SELECT COUNT(*) as count FROM agreements WHERE status = "pending"'
);

        // 🔍 DEBUG: تحقق من الطلاب المقبولين
        const [acceptedStudents] = await db.execute(`
            SELECT COUNT(*) as count 
            FROM student_internships 
            WHERE status = 'accepted'
        `);
        console.log('📊 Accepted students count (total):', acceptedStudents[0].count);

        // 🔍 DEBUG: تحقق من الطلاب المصادق عليهم
        const [validatedStudents] = await db.execute(`
            SELECT COUNT(*) as count 
            FROM student_internships 
            WHERE status = 'accepted' AND is_validated = 1
        `);
        console.log('📊 Validated students count (is_validated=1):', validatedStudents[0].count);

        // ✅ 6️⃣ الطلاب الموظفين (Placed) - هذا هو المهم!
        const [placedStudents] = await db.execute(`
            SELECT COUNT(DISTINCT si.student_id) as count 
            FROM student_internships si
            WHERE si.status = 'accepted' 
            AND (si.is_validated = 1 OR si.is_validated IS TRUE)
        `);
        console.log('📊 Placed students count (DISTINCT):', placedStudents[0].count); // ✅ هذا سيطبع في الـ Terminal

        // ✅ 7️⃣ الطلاب قيد المعالجة
        const [inProgress] = await db.execute(`
            SELECT COUNT(DISTINCT student_id) as count 
            FROM student_internships 
            WHERE status IN ('pending', 'reviewed', 'interview')
        `);

        // ✅ 8️⃣ الطلاب غير الموظفين
        const [unplaced] = await db.execute(`
            SELECT COUNT(*) as count 
            FROM users u 
            WHERE u.user_type = 'student' 
            AND NOT EXISTS (
                SELECT 1 FROM student_internships si 
                WHERE si.student_id = u.id 
                AND si.status = 'accepted' 
                AND (si.is_validated = 1 OR si.is_validated IS TRUE)
            )
        `);

        // ✅ 9️⃣ قبولات تنتظر المصادقة
        const [pendingAcceptances] = await db.execute(`
            SELECT COUNT(*) as count 
            FROM student_internships 
            WHERE status = 'accepted' 
            AND (is_validated = 0 OR is_validated IS NULL OR is_validated = FALSE)
        `);

        console.log('📊 Final stats:', { // هذا سيطبع كل الإحصائيات
            placed: placedStudents[0].count || 0,
            inProgress: inProgress[0].count || 0,
            unplaced: unplaced[0].count || 0,
            pendingAcceptances: pendingAcceptances[0].count || 0
        });

        res.json({
            success: true,
            stats: {
                totalCompanies: totalCompanies[0].count,
                totalStudents: totalStudents[0].count,
                totalInternships: totalInternships[0].count,
                pendingCompanies: pendingCompanies[0].count,
                pendingAgreements: pendingAgreements[0].count || 0,
                placed: placedStudents[0].count || 0,
                inProgress: inProgress[0].count || 0,
                unplaced: unplaced[0].count || 0,
                pendingAcceptances: pendingAcceptances[0].count || 0
            }
        });

    } catch (error) {
        console.error('🔥 Error fetching stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching stats',
            error: error.message
        });
    }
});


app.get('/api/admin/placement-stats', protect, async (req, res) => {
  try {
    console.log('📊 Fetching placement stats...');
    
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    // حساب الطلاب الموظفين (placed)
// student has validated internship (admin validated)
const [placed] = await db.execute(`
  SELECT COUNT(DISTINCT si.student_id) as count
  FROM student_internships si
  WHERE si.is_validated = 1
`);
    console.log('✅ Placed count (with signed agreement):', placed[0].count);

    // حساب الطلاب قيد المعالجة (in progress)
    // students with pending/reviewed/interview applications
    const [inProgress] = await db.execute(`
      SELECT COUNT(DISTINCT student_id) as count
      FROM student_internships
      WHERE status IN ('pending', 'reviewed', 'interview')
    `);
    console.log('✅ In Progress count:', inProgress[0].count);

    // حساب إجمالي الطلاب
    const [totalStudents] = await db.execute(`
      SELECT COUNT(*) as count FROM users WHERE user_type = 'student'
    `);
    console.log('✅ Total Students:', totalStudents[0].count);
    
    // حساب الطلاب الذين تقدموا على الأقل لتدريب واحد
    const [withApplications] = await db.execute(`
      SELECT COUNT(DISTINCT student_id) as count FROM student_internships
    `);
    console.log('✅ Students with applications:', withApplications[0].count);
    
    // حساب الطلاب غير الموظفين (unplaced)
    // total students - students with applications + students with accepted but no agreement
    const [acceptedWithoutAgreement] = await db.execute(`
      SELECT COUNT(DISTINCT si.student_id) as count
      FROM student_internships si
      LEFT JOIN agreements a ON si.student_id = a.student_id 
                            AND si.internship_id = a.internship_id
      WHERE si.status = 'accepted' 
        AND (a.id IS NULL OR a.status != 'signed')
    `);



    console.log('🔍 DEBUG - Values:', {
  totalStudents: totalStudents[0].count,
  withApplications: withApplications[0].count,
  acceptedWithoutAgreement: acceptedWithoutAgreement[0].count,
  placed: placed[0].count,
  inProgress: inProgress[0].count
});
    
    // حساب الطلاب غير الموظفين (unplaced) - نسخة مصححة
const unplaced = totalStudents[0].count - placed[0].count;
console.log('✅ Unplaced:', unplaced);

res.json({
  success: true,
  stats: {
    placed: placed[0].count || 0,
    inProgress: inProgress[0].count || 0,
    unplaced: unplaced > 0 ? unplaced : 0  // ✅ 2 - 1 = 1
  }
});

  } catch (error) {
    console.error('🔥 Error fetching placement stats:', error);
    console.error('Error details:', error.message);
    console.error('SQL Error:', error.sqlMessage);
    
    // Fallback بسيط: حساب من student_internships فقط
    try {
      const [placed] = await db.execute(`
        SELECT COUNT(DISTINCT student_id) as count
        FROM student_internships
        WHERE status = 'accepted'
      `);
      
      const [inProgress] = await db.execute(`
        SELECT COUNT(DISTINCT student_id) as count
        FROM student_internships
        WHERE status IN ('pending', 'reviewed', 'interview')
      `);
      
      const [totalStudents] = await db.execute(`
        SELECT COUNT(*) as count FROM users WHERE user_type = 'student'
      `);
      
      const [withApplications] = await db.execute(`
        SELECT COUNT(DISTINCT student_id) as count FROM student_internships
      `);
      
      const unplaced = totalStudents[0].count - withApplications[0].count;
      
      return res.json({
        success: true,
        stats: {
          placed: placed[0].count || 0,
          inProgress: inProgress[0].count || 0,
          unplaced: unplaced > 0 ? unplaced : 0
        }
      });
    } catch (fallbackError) {
      return res.status(500).json({
        success: false,
        message: 'Error fetching placement stats',
        error: error.message
      });
    }
  }
});


// Student Management
app.get('/api/admin/students/:id', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const studentId = req.params.id;

    const [students] = await db.execute(`
      SELECT 
        s.user_id as id,
        s.first_name,
        s.last_name,
        u.email,
        s.phone,
        s.birth_date,
        s.university,
        s.specialization,
        s.year_of_study,
        s.skills,
        s.soft_skills,
        s.github_link,
        s.linkedin_link,
        s.profile_image_url,
        s.wilaya,
        s.bio,
        s.social_security,
        s.academic_supervisor,
        s.created_at,
        s.experiences,
        u.is_suspended
      FROM students s
      JOIN users u ON s.user_id = u.id
      WHERE s.user_id = ? AND u.user_type = 'student'
    `, [studentId]);

    if (students.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Student not found' 
      });
    }

    const student = students[0];
    
    // Parse skills
    if (student.skills) {
      try {
        student.skills = JSON.parse(student.skills);
      } catch (e) {
        student.skills = [];
      }
    }
    
    // Parse soft skills
    if (student.soft_skills) {
      try {
        student.soft_skills = JSON.parse(student.soft_skills);
      } catch (e) {
        student.soft_skills = [];
      }
    }
    
    // ✅ Parse experiences - أضف هذا
    if (student.experiences) {
      try {
        student.experiences = typeof student.experiences === 'string' 
          ? JSON.parse(student.experiences) 
          : student.experiences;
      } catch (e) {
        student.experiences = [];
      }
    } else {
      student.experiences = [];
    }

    res.json({
      success: true,
      student
    });

  } catch (error) {
    console.error('🔥 Error fetching student:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching student details',
      error: error.message 
    });
  }
});


app.get('/api/admin/students/:id/applications', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const studentId = req.params.id;

    const [applications] = await db.execute(`
      SELECT 
        si.id,
        si.status,
        si.applied_at,
        i.title as internship_title,
        c.company_name
      FROM student_internships si
      JOIN internships i ON si.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE si.student_id = ?
      ORDER BY si.applied_at DESC
    `, [studentId]);

    res.json({
      success: true,
      applications
    });

  } catch (error) {
    console.error('🔥 Error fetching applications:', error);
    res.json({ success: true, applications: [] });
  }
});


app.get('/api/admin/students/:id/agreements', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const studentId = req.params.id;

    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.status,
        a.created_at,
        i.title as internship_title,
        c.company_name
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE a.student_id = ?
      ORDER BY a.created_at DESC
    `, [studentId]);

    res.json({
      success: true,
      agreements
    });

  } catch (error) {
    console.error('🔥 Error fetching agreements:', error);
    res.json({ success: true, agreements: [] });
  }
});



// Applications Validation
app.get('/api/admin/internships/:applicationId/details', protect, async (req, res) => {
  try {
    const applicationId = req.params.applicationId;
    
    console.log('🔍 Fetching internship details:', applicationId);
    
    const [applications] = await db.execute(`
      SELECT 
        si.id as application_id,
        si.student_id,
        si.internship_id,
        si.status,
        si.is_validated,
        si.applied_at,
        si.reviewed_at,
        si.feedback as company_feedback,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.first_name,
        s.last_name,
        s.university,
        s.specialization,
        s.year_of_study,
        s.phone as student_phone,
        s.bio as student_bio,
        s.skills,
        s.github_link,
        s.linkedin_link,
        s.profile_image_url,
        s.social_security,        -- ✅ أضف هذا
        s.academic_supervisor, 
        u.email as student_email,
        i.id as internship_id,
        i.title as internship_title,
        i.description as internship_description,
        i.location,
        i.type as internship_type,
        i.duration,
        i.stipend,
        i.stipend_type,
        i.required_skills,
        i.requirements,
        i.benefits,
        i.deadline,
        i.positions_available,
        i.created_at as internship_posted_at,
        c.company_name,
        c.user_id as company_id,
        c.company_email,
        c.phone as company_phone,
        c.website,
        c.trade_register,
        c.activity_sector,
        c.company_size,
        c.wilaya as company_location,
        c.address,
        c.contact_person,
        c.position as contact_position,
        c.description as company_description,
        c.logo_url,
        c.average_rating
      FROM student_internships si
      JOIN students s ON si.student_id = s.user_id
      JOIN users u ON s.user_id = u.id
      JOIN internships i ON si.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE si.id = ?
    `, [applicationId]);
    
    if (applications.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Internship not found' 
      });
    }
    
    const application = applications[0];
    
    // Parse JSON to array
    if (application.skills) {
      try {
        application.skills = JSON.parse(application.skills);
      } catch (e) {
        application.skills = [];
      }
    }
    
    if (application.required_skills) {
      try {
        application.required_skills = JSON.parse(application.required_skills);
      } catch (e) {
        application.required_skills = [];
      }
    }
    
    res.json({
      success: true,
      application: application
    });
    
  } catch (error) {
    console.error('🔥 Error fetching details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching internship details',
      error: error.message 
    });
  }
});


app.put('/api/admin/applications/:id/reject', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const applicationId = req.params.id;
    const { reason } = req.body;
    
    console.log('❌ Rejecting internship:', applicationId, 'Reason:', reason);
    
    if (!reason) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Rejection reason is required' 
      });
    }
    
    // Get application details
    const [applications] = await connection.execute(`
      SELECT 
        si.*,
        i.title as internship_title,
        i.company_id,
        c.company_name,
        s.first_name,
        s.last_name,
        u.id as student_user_id,
        u.email as student_email
      FROM student_internships si
      JOIN internships i ON si.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON si.student_id = s.user_id
      JOIN users u ON s.user_id = u.id
      WHERE si.id = ?
    `, [applicationId]);
    
    if (applications.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Internship not found' 
      });
    }
    
    const application = applications[0];
    
    // Update application status to rejected
    await connection.execute(
      'UPDATE student_internships SET status = ?, feedback = ? WHERE id = ?',
      ['rejected', reason, applicationId]
    );
    
    await connection.execute(
        `UPDATE admin_notifications 
         SET type = 'rejection_processed',
             title = '❌ Rejection Processed',
             is_read = 1,
             data = JSON_SET(IFNULL(data, '{}'), '$.rejected', TRUE, '$.reason', ?)
         WHERE application_id = ? AND type = 'company_accept'`,
        [reason, applicationId]
    );
    console.log('✅ Old admin notification updated to rejection_processed');


    // ✅ 1. Notification for STUDENT
    await connection.execute(
      `INSERT INTO notifications 
       (user_id, type, title, message, application_id, created_at) 
       VALUES (?, 'rejection', ?, ?, ?, NOW())`,
      [
        application.student_user_id,
        '❌ Internship Rejected',
        `Your internship "${application.internship_title}" at ${application.company_name} has been rejected by the administration. Reason: ${reason}`,
        applicationId
      ]
    );
    
    // ✅ 2. Notification for COMPANY
    await connection.execute(
      `INSERT INTO company_notifications 
       (company_id, type, title, message, application_id, created_at) 
       VALUES (?, 'rejection', ?, ?, ?, NOW())`,
      [
        application.company_id,
        '❌ Internship Rejected',
        `The internship "${application.internship_title}" for student ${application.first_name} ${application.last_name} has been rejected by the administration. Reason: ${reason}`,
        applicationId
      ]
    );
    
    // ✅ 3. Notification for ADMIN (confirmation)
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, student_id, company_id, application_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'rejection_complete',
        '❌ Rejection Processed',
        `Internship rejected for ${application.first_name} ${application.last_name} at ${application.company_name}. Reason: ${reason}`,
        application.student_user_id,
        application.company_id,
        applicationId
      ]
    );
    
    await connection.commit();
    connection.release();
    
    res.json({ 
      success: true, 
      message: 'Internship rejected successfully' 
    });
    
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('🔥 Error in rejection:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error rejecting internship' 
    });
  }
});


// Agreements Management
app.post('/api/admin/agreements/generate-from-validation', protect, async (req, res) => {
    try {
        if (req.user.user_type !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin only' });
        }

        const { applicationId } = req.body;
        
        // جلب بيانات التقديم
        const [applications] = await db.execute(`
            SELECT 
                si.id as application_id,
                si.student_id,
                si.internship_id,
                i.title as internship_title,
                i.company_id,
                c.company_name,
                CONCAT(s.first_name, ' ', s.last_name) as student_name
            FROM student_internships si
            JOIN internships i ON si.internship_id = i.id
            JOIN companies c ON i.company_id = c.user_id
            JOIN students s ON si.student_id = s.user_id
            WHERE si.id = ? AND si.status = 'accepted' AND si.is_validated = 1
        `, [applicationId]);
        
        if (applications.length === 0) {
            return res.status(404).json({ success: false, message: 'Validated application not found' });
        }
        
        const application = applications[0];
        
        // التحقق من وجود اتفاقية مسبقة
        const [existing] = await db.execute(
            'SELECT id FROM agreements WHERE student_id = ? AND internship_id = ?',
            [application.student_id, application.internship_id]
        );
        
        if (existing.length > 0) {
            return res.json({ success: true, message: 'Agreement already exists', agreement_id: existing[0].id });
        }
        
        // إنشاء اتفاقية جديدة
        const [result] = await db.execute(`
            INSERT INTO agreements 
            (student_id, internship_id, status, generated_at, university_name, created_at)
            VALUES (?, ?, 'pending', NOW(), ?, NOW())
        `, [application.student_id, application.internship_id, 'University of Constantine']);
        
        // ✅ استخدم المتغير agreementId
        const agreementId = result.insertId;
        
        // إشعار للأدمن
        await db.execute(`
            INSERT INTO admin_notifications 
            (type, title, message, agreement_id, student_id, company_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [
            'agreement_generated', 
            '📄 Agreement Generated', 
            `Agreement generated for ${application.student_name} at ${application.company_name}`,
            agreementId, 
            application.student_id, 
            application.company_id
        ]);
        
        console.log('✅ Agreement created with ID:', agreementId);
        
        res.json({ success: true, message: 'Agreement generated successfully', agreement_id: agreementId });
        
    } catch (error) {
        console.error('Error generating agreement:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


app.post('/api/admin/agreements/:id/send', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const agreementId = req.params.id;
    
    console.log(`📧 Sending agreement ID: ${agreementId}`);

    // جلب بيانات الاتفاقية
    const [agreements] = await db.execute(`
      SELECT 
        a.*,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        u.email as student_email,
        i.title as internship_title,
        c.company_name,
        cu.email as company_email
      FROM agreements a
      JOIN students s ON a.student_id = s.user_id
      JOIN users u ON s.user_id = u.id
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN users cu ON c.user_id = cu.id
      WHERE a.id = ?
    `, [agreementId]);

    if (agreements.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }

    const agreement = agreements[0];
    
    // إنشاء رابط PDF
    const pdfLink = `http://localhost:5000${agreement.pdf_url}`;
    
    // إرسال البريد (اختياري - يمكنك تفعيله لاحقاً)
    console.log('📨 Email would be sent to:', {
      to: [agreement.student_email, agreement.company_email],
      subject: `Internship Agreement - ${agreement.internship_title}`,
      pdfLink
    });
    
    // ✅✅✅ أهم جزء: تحديث الحالة إلى "sent" ✅✅✅
    await db.execute(
      `UPDATE agreements 
       SET sent_at = NOW(), 
           status = 'sent' 
       WHERE id = ?`,
      [agreementId]
    );
    
    console.log(`✅ Agreement ${agreementId} status updated to 'sent'`);

    res.json({ 
      success: true, 
      message: '✅ Agreement sent successfully and status updated to "sent"',
      agreementId
    });

  } catch (error) {
    console.error('🔥 Error sending agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error sending agreement',
      error: error.message 
    });
  }
});


app.get('/api/admin/agreements/:agreementId', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const agreementId = req.params.agreementId;
    
    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.generated_at,
        a.sent_at,
        a.signed_at,
        a.archived_at,
        a.pdf_url,
        a.university_name,
        a.created_at,
        a.student_signed,
        a.company_signed,
        a.university_signed,
        a.signature_url,
        a.company_signature_url,
        a.university_signature_url,
        a.company_signed_at,        -- ✅ أضف هذا
        a.university_signed_at,     -- ✅ أضف هذا
        a.completed_at,              -- ✅ أضف هذا
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.first_name,
        s.last_name,
        s.university,
        u.email as student_email,
        i.title as internship_title,
        i.description,
        i.duration,
        i.stipend,
        i.location,
        i.type as internship_type,
        c.company_name,
        c.user_id as company_id
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      JOIN users u ON s.user_id = u.id
      WHERE a.id = ?
    `, [agreementId]);

    if (agreements.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }

    res.json({
      success: true,
      agreement: agreements[0]
    });

  } catch (error) {
    console.error('🔥 Error fetching agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching agreement',
      error: error.message 
    });
  }
});


app.get('/api/admin/agreements/:agreementId/download', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const agreementId = req.params.agreementId;
    
    console.log('📄 Admin generating dynamic PDF for agreement:', agreementId);
    
    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.created_at,
        a.university_name,
        a.signature_url,              
        a.company_signature_url,      
        a.university_signature_url,
        
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.first_name,
        s.last_name,
        s.university,
        s.student_id as student_card_id,
        s.phone as student_phone,
        s.social_security,
        s.academic_supervisor,
        
        i.title as internship_title,
        i.duration,
        i.stipend,
        i.start_date as internship_start_date,
        i.end_date as internship_end_date,
        
        c.company_name,
        c.address as company_address,
        c.contact_person as company_representative,
        c.phone as company_phone
        
      FROM agreements a
      JOIN students s ON a.student_id = s.user_id
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE a.id = ?
    `, [agreementId]);
    
    if (agreements.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }
    
    const agreement = agreements[0];

     // ✅ ✅ ✅ أضف Console.log هنا ✅ ✅ ✅
    console.log('📊 Signatures from DB:', {
      signature_url: agreement.signature_url,
      company_signature_url: agreement.company_signature_url,
      university_signature_url: agreement.university_signature_url
    });
    
    // ✅ حساب end_date تلقائياً إذا كان NULL
    let startDateValue = agreement.internship_start_date || agreement.created_at;
    let endDateValue = agreement.internship_end_date || '';
    
    if (!endDateValue && agreement.duration) {
      const start = new Date(startDateValue);
      const end = new Date(start);
      end.setMonth(end.getMonth() + (parseInt(agreement.duration) || 3));
      endDateValue = end.toISOString().split('T')[0];
      console.log('✅ Auto-calculated end_date:', endDateValue);
    }
    
    const pdfData = {
      studentName: agreement.student_name,
      studentId: agreement.student_card_id || '___________________',
      socialSecurity: agreement.social_security || '___________________',
      studentPhone: agreement.student_phone || '___________________',
      companyName: agreement.company_name,
      companyAddress: agreement.company_address || '___________________',
      companyRepresentative: agreement.company_representative || '___________________',
      companyPhone: agreement.company_phone || '___________________',
      internshipTitle: agreement.internship_title,
      supervisor: agreement.academic_supervisor || '___________________',
      duration: agreement.duration || '3',
      startDate: startDateValue,
      endDate: endDateValue,
      studentSignature: agreement.signature_url,
      companySignature: agreement.company_signature_url,
      universitySignature: agreement.university_signature_url
    };
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=convention_stage_${agreement.student_name.replace(/\s+/g, '_')}.pdf`);
    
    //await generateConventionDeStagePDF(pdfData, res);
    await generateEnglishAgreementPDF(pdfData, res);
    
  } catch (error) {
    console.error('🔥 Error downloading agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error downloading agreement: ' + error.message 
    });
  }
});


app.put('/api/admin/agreements/:agreementId/sign', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const adminId = req.user.id;
    const agreementId = req.params.agreementId;
    const { signature, signature_type, typed_name } = req.body;
    
    console.log('\n' + '='.repeat(50));
    console.log('🎓 Admin Signing Agreement with Signature (University)');
    console.log('='.repeat(50));
    console.log('📌 Admin ID:', adminId);
    console.log('📌 Agreement ID:', agreementId);
    console.log('📌 Signature Received:', signature ? 'Yes ✓' : 'No ✗');
    console.log('='.repeat(50) + '\n');
    
    if (!signature) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Please add your university signature first' 
      });
    }
    
    const [agreements] = await connection.execute(
      `SELECT a.*, i.title, i.company_id,
              s.user_id as student_id,
              CONCAT(s.first_name, ' ', s.last_name) as student_name,
              c.company_name
       FROM agreements a
       JOIN internships i ON a.internship_id = i.id
       JOIN companies c ON i.company_id = c.user_id
       JOIN students s ON a.student_id = s.user_id
       WHERE a.id = ?`,
      [agreementId]
    );
    
    if (agreements.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }
    
    const agreement = agreements[0];
    
    if (agreement.status === 'completed') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Agreement already completed' 
      });
    }
    
    // حفظ توقيع الجامعة
    let signaturePath = null;
    if (signature) {
      const base64Data = signature.replace(/^data:image\/png;base64,/, '');
      const signatureFileName = `university_signature_${agreementId}_${Date.now()}.png`;
      const signatureFilePath = path.join(__dirname, 'uploads', 'signatures', signatureFileName);
      
      const signatureDir = path.join(__dirname, 'uploads', 'signatures');
      if (!fs.existsSync(signatureDir)) {
        fs.mkdirSync(signatureDir, { recursive: true });
      }
      
      fs.writeFileSync(signatureFilePath, base64Data, 'base64');
      signaturePath = `/uploads/signatures/${signatureFileName}`;
      console.log('✅ University signature saved at:', signaturePath);
    }
    
    // ✅ تحديث مع university_signed_at
    await connection.execute(
    `UPDATE agreements 
     SET status = 'completed',
         university_signed = 1,
         university_signature_url = ?,
         university_signature_type = ?,
         university_typed_name = ?,
         university_signed_at = NOW(),
         updated_at = NOW(),
         completed_at = NOW()
     WHERE id = ?`,
    [signaturePath, signature_type, typed_name || null, agreementId]
);
    
    console.log('✅ Agreement marked as completed');
    
    // ✅ إشعار للطالب
    await connection.execute(
      `INSERT INTO notifications 
       (user_id, type, title, message, agreement_id, created_at) 
       VALUES (?, 'agreement_completed', ?, ?, ?, NOW())`,
      [
        agreement.student_id,
        '🎉 All Parties Signed!',
        `All parties have signed the agreement for "${agreement.title}". Your internship is now active.`,
        agreementId
      ]
    );
    console.log('✅ Student notification created');
    
    // ✅ إشعار للشركة
    await connection.execute(
      `INSERT INTO company_notifications 
       (company_id, type, title, message, agreement_id, created_at) 
       VALUES (?, 'agreement_completed', ?, ?, ?, NOW())`,
      [
        agreement.company_id,
        '🎉 Agreement Completed',
        `All parties have signed the agreement for "${agreement.title}".`,
        agreementId
      ]
    );
    console.log('✅ Company notification created');
    
    // ✅ إشعار للأدمن
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, company_id, student_id, agreement_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'agreement_completed',
        '✅ Agreement Completed',
        `${agreement.student_name} - ${agreement.company_name} agreement completed.`,
        agreement.company_id,
        agreement.student_id,
        agreementId
      ]
    );
    console.log('✅ Admin notification created');
    
    await connection.commit();
    connection.release();
    
    console.log('✅ University agreement signed successfully!\n');
    
    res.json({ 
      success: true, 
      message: '✅ Agreement completed by university!' 
    });
    
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('🔥 Error signing agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error signing agreement: ' + error.message 
    });
  }
});


/*
app.put('/api/admin/agreements/:agreementId/sign', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const agreementId = req.params.agreementId;
    const { signature, signature_type, typed_name } = req.body;
    
    // التحقق من وجود الاتفاقية
    const [agreements] = await connection.execute(
      'SELECT * FROM agreements WHERE id = ?',
      [agreementId]
    );
    
    if (agreements.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }
    
    // حفظ توقيع الجامعة
    let signaturePath = null;
    if (signature) {
      const base64Data = signature.replace(/^data:image\/png;base64,/, '');
      const signatureFileName = `university_signature_${agreementId}_${Date.now()}.png`;
      const signatureFilePath = path.join(__dirname, 'uploads', 'signatures', signatureFileName);
      
      const signatureDir = path.join(__dirname, 'uploads', 'signatures');
      if (!fs.existsSync(signatureDir)) {
        fs.mkdirSync(signatureDir, { recursive: true });
      }
      
      fs.writeFileSync(signatureFilePath, base64Data, 'base64');
      signaturePath = `/uploads/signatures/${signatureFileName}`;
    }
    
    // تحديث الاتفاقية
    await connection.execute(
      `UPDATE agreements 
       SET status = 'completed',
           university_signed = 1,
           university_signature_url = ?,
           university_signature_type = ?,
           university_typed_name = ?,
           university_signed_at = NOW(),
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [signaturePath, signature_type, typed_name || null, agreementId]
    );
    
    await connection.commit();
    connection.release();
    
    res.json({ 
      success: true, 
      message: 'Agreement signed by university successfully!' 
    });
    
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Error signing agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error signing agreement' 
    });
  }
});
*/
/*
app.put('/api/admin/agreements/:agreementId/archive', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    const agreementId = req.params.agreementId;
    
    // ✅ تحديث archived_at
    await db.execute(
      'UPDATE agreements SET status = "archived", archived_at = NOW() WHERE id = ?',
      [agreementId]
    );
    
    res.json({ success: true, message: 'Agreement archived successfully' });
  } catch (error) {
    console.error('Error archiving agreement:', error);
    res.status(500).json({ success: false, message: 'Error archiving agreement' });
  }
});
app.put('/api/admin/agreements/:agreementId/unarchive', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }
    
    const agreementId = req.params.agreementId;
    
    // ✅ إلغاء الأرشفة وإعادة الحالة إلى "completed"
    const [result] = await db.execute(
      'UPDATE agreements SET status = "completed", archived_at = NULL WHERE id = ? AND status = "archived"',
      [agreementId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found or not archived' 
      });
    }
    
    console.log(`✅ Agreement ${agreementId} unarchived successfully`);
    
    res.json({ 
      success: true, 
      message: 'Agreement unarchived successfully' 
    });
    
  } catch (error) {
    console.error('Error unarchiving agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error unarchiving agreement' 
    });
  }
});
*/

app.put('/api/admin/agreements/:agreementId/archive', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    const agreementId = req.params.agreementId;
    
    // جلب الحالة الحالية
    const [agreements] = await db.execute(
      'SELECT status FROM agreements WHERE id = ?',
      [agreementId]
    );
    
    if (agreements.length === 0) {
      return res.status(404).json({ success: false, message: 'Agreement not found' });
    }
    
    const currentStatus = agreements[0].status;
    
    // ✅ أرشفة وحفظ الحالة الأصلية في عمود data (JSON)
    await db.execute(
      `UPDATE agreements 
       SET status = 'archived', 
           archived_at = NOW(),
           data = JSON_SET(IFNULL(data, '{}'), '$.original_status', ?)
       WHERE id = ?`,
      [currentStatus, agreementId]
    );
    
    console.log(`✅ Agreement ${agreementId} archived, original status: ${currentStatus}`);
    
    res.json({ success: true, message: 'Agreement archived successfully' });
  } catch (error) {
    console.error('Error archiving agreement:', error);
    res.status(500).json({ success: false, message: 'Error archiving agreement' });
  }
});


app.put('/api/admin/agreements/:agreementId/unarchive', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }
    
    const agreementId = req.params.agreementId;
    
    // ✅ جلب الحالة الأصلية من عمود data
    const [agreements] = await db.execute(
      'SELECT data FROM agreements WHERE id = ? AND status = "archived"',
      [agreementId]
    );
    
    if (agreements.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found or not archived' 
      });
    }
    
    // ✅ استخراج الحالة الأصلية من JSON
    let originalStatus = 'pending';
    if (agreements[0].data) {
      try {
        const data = JSON.parse(agreements[0].data);
        originalStatus = data.original_status || 'pending';
      } catch(e) {}
    }
    
    // ✅ استعادة الحالة الأصلية ومسح عمود data
    await db.execute(
      `UPDATE agreements 
       SET status = ?, 
           archived_at = NULL,
           data = NULL
       WHERE id = ?`,
      [originalStatus, agreementId]
    );
    
    console.log(`✅ Agreement ${agreementId} unarchived successfully, status restored to: ${originalStatus}`);
    
    res.json({ 
      success: true, 
      message: 'Agreement unarchived successfully' 
    });
    
  } catch (error) {
    console.error('Error unarchiving agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error unarchiving agreement' 
    });
  }
});


// Document Generation
app.post('/api/admin/certificates/generate', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const { studentName, companyName, internshipTitle, agreementId } = req.body;

    // جلب بيانات إضافية
    const [agreements] = await db.execute(`
      SELECT a.created_at, i.duration, i.start_date, i.end_date
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      WHERE a.id = ?
    `, [agreementId]);
    
    let startDate = 'March 1, 2026';
    let endDate = 'May 31, 2026';
    
    if (agreements.length > 0) {
      const agreement = agreements[0];
      if (agreement.start_date) {
        startDate = new Date(agreement.start_date).toLocaleDateString('en-GB', {
          year: 'numeric', month: 'long', day: 'numeric'
        });
      }
      if (agreement.end_date) {
        endDate = new Date(agreement.end_date).toLocaleDateString('en-GB', {
          year: 'numeric', month: 'long', day: 'numeric'
        });
      }
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const fs = require('fs');
    const path = require('path');
    
    const uploadDir = path.join(__dirname, 'uploads', 'certificates');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const fileName = `certificate_${studentName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);
    
    // ========== تصميم بسيط مع شعار الجامعة ==========
    
   

// إطار خارجي بسيط
doc.rect(30, 30, 540, 780).lineWidth(1).stroke('#CCCCCC');

// ✅ شعار الجامعة في أعلى اليسار
const logoPath = path.join(__dirname, 'uploads', 'logo-univ.png');
if (fs.existsSync(logoPath)) {
  doc.image(logoPath, 50, 50, { width: 60, height: 60 });
  console.log('✅ University logo added to certificate');
} else {
  console.log('⚠️ Logo file not found:', logoPath);
}

// ✅ شريط علوي رفيع (فوق الشعار)
//doc.rect(30, 30, 540, 3).fill('#4F46E5');

// ✅ عنوان STAG في المنتصف
doc.fontSize(22)
   .font('Helvetica-Bold')
   .fillColor('#4F46E5')
   .text('STAG', 0, 70, { align: 'center' });

// ✅ النص الوصفي تحت STAG
doc.fontSize(9)
   .font('Helvetica')
   .fillColor('#888888')
   .text('Internship & Matching Platform', 0, 95, { align: 'center' });

// خط فاصل زخرفي تحت النص الوصفي
doc.moveTo(150, 115).lineTo(460, 115).lineWidth(0.5).stroke('#CCCCCC');
    
    // عنوان الشهادة
    doc.fillColor('#1F2937')
       .fontSize(28)
       .font('Helvetica-Bold')
       .text('CERTIFICATE', 0, 150, { align: 'center' });
    
    doc.fillColor('#666666')
       .fontSize(12)
       .font('Helvetica')
       .text('of Internship Completion', 0, 175, { align: 'center' });
    
    // خط زخرفي
    doc.moveTo(200, 195).lineTo(410, 195).lineWidth(0.5).stroke('#CCCCCC');
    
    // نص الشهادة
    doc.fillColor('#374151')
       .fontSize(12)
       .font('Helvetica')
       .text('This is to certify that', 0, 220, { align: 'center' });
    
    // اسم الطالب
    doc.fillColor('#1F2937')
       .fontSize(24)
       .font('Helvetica-Bold')
       .text(studentName, 0, 260, { align: 'center' });
    
    doc.fillColor('#374151')
       .fontSize(12)
       .font('Helvetica')
       .text('has successfully completed the internship program at', 0, 310, { align: 'center' });
    
    // اسم الشركة
    doc.fillColor('#4F46E5')
       .fontSize(18)
       .font('Helvetica-Bold')
       .text(companyName, 0, 350, { align: 'center' });
    
    doc.fillColor('#374151')
       .fontSize(12)
       .font('Helvetica')
       .text('for the position of', 0, 390, { align: 'center' });
    
    // عنوان التدريب
    doc.fillColor('#1F2937')
       .fontSize(16)
       .font('Helvetica-Bold')
       .text(internshipTitle, 0, 425, { align: 'center' });
    
    // معلومات التدريب
    doc.fillColor('#666666')
       .fontSize(10)
       .font('Helvetica')
       .text(`Period: ${startDate} - ${endDate}`, 0, 465, { align: 'center' });
    
    doc.text(`Duration: ${agreements[0]?.duration || 3} months`, 0, 480, { align: 'center' });
    
    // التاريخ والتوقيع في أسفل الصفحة
    const issueDate = new Date().toLocaleDateString('en-GB', { 
      year: 'numeric', month: 'long', day: 'numeric' 
    });

    doc.fillColor('#666666')
       .fontSize(9)
       .font('Helvetica')
       .text(`Authorized on: ${issueDate}`, 350, 680);

    const adminName = 'University Administrator';

    doc.fillColor('#4F46E5')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text(adminName, 350, 700, { align: 'center' });
    
    // رقم الشهادة
    const certNumber = `CERT-${Date.now().toString().slice(-8)}`;
    doc.fillColor('#999999')
       .fontSize(8)
       .font('Helvetica')
       .text(certNumber, 50, 760);
    
    doc.end();
    
    writeStream.on('finish', async () => {
      console.log(`✅ Certificate saved: ${filePath}`);
      
      try {
        const fileUrl = `/uploads/certificates/${fileName}`;
        await db.execute(
          `INSERT INTO documents 
           (agreement_id, document_type, file_url, file_name, generated_by, generated_at) 
           VALUES (?, 'certificate', ?, ?, ?, NOW())`,
          [agreementId, fileUrl, fileName, req.user.id]
        );
      } catch (dbError) {
        console.error('❌ Error saving certificate record:', dbError);
      }
      
      res.download(filePath, fileName);
    });
    
  } catch (error) {
    console.error('🔥 Error generating certificate:', error);
    res.status(500).json({ success: false, message: 'Error generating certificate' });
  }
});




app.post('/api/admin/evaluation/generate', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const { studentName, companyName, internshipTitle, agreementId } = req.body;

    // جلب بيانات إضافية
    const [agreements] = await db.execute(`
      SELECT a.created_at, i.duration, i.start_date, i.end_date
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      WHERE a.id = ?
    `, [agreementId]);
    
    let startDate = 'March 1, 2026';
    let endDate = 'May 31, 2026';
    
    if (agreements.length > 0) {
      const agreement = agreements[0];
      if (agreement.start_date) {
        startDate = new Date(agreement.start_date).toLocaleDateString('en-GB', {
          year: 'numeric', month: 'long', day: 'numeric'
        });
      }
      if (agreement.end_date) {
        endDate = new Date(agreement.end_date).toLocaleDateString('en-GB', {
          year: 'numeric', month: 'long', day: 'numeric'
        });
      }
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const fs = require('fs');
    const path = require('path');
    
    const uploadDir = path.join(__dirname, 'uploads', 'evaluations');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const fileName = `evaluation_${studentName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);
    
    // ========== تصميم مثل الشهادة ==========
    
    // الإطار الخارجي
    doc.rect(30, 30, 540, 780).lineWidth(1).stroke('#CCCCCC');
    
    // شعار الجامعة
    const logoPath = path.join(__dirname, 'uploads', 'logo-univ.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 50, { width: 60, height: 60 });
    }
    
    // عنوان STAG
    doc.fontSize(22)
       .font('Helvetica-Bold')
       .fillColor('#4F46E5')
       .text('STAG', 0, 70, { align: 'center' });
    
    doc.fontSize(9)
       .font('Helvetica')
       .fillColor('#888888')
       .text('Internship & Matching Platform', 0, 95, { align: 'center' });
    
    doc.moveTo(150, 115).lineTo(460, 115).lineWidth(0.5).stroke('#CCCCCC');
    
    // عنوان النموذج
    doc.fillColor('#1F2937')
       .fontSize(20)
       .font('Helvetica-Bold')
       .text('INTERNSHIP EVALUATION FORM', 0, 150, { align: 'center' });
    
    doc.fillColor('#666666')
       .fontSize(10)
       .font('Helvetica')
       .text('Performance Assessment', 0, 175, { align: 'center' });
    
    doc.moveTo(200, 195).lineTo(410, 195).lineWidth(0.5).stroke('#CCCCCC');
    
    // معلومات الطالب
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .fillColor('#374151')
       .text('Student Information', 50, 220);
    
    doc.fontSize(9)
       .font('Helvetica')
       .fillColor('#4B5563')
       .text(`Name: ${studentName}`, 50, 240)
       .text(`Company: ${companyName}`, 50, 255)
       .text(`Position: ${internshipTitle}`, 50, 270)
       .text(`Period: ${startDate} - ${endDate}`, 50, 285);
    
    doc.moveTo(50, 305).lineTo(560, 305).stroke('#E5E7EB');
    
    // جدول التقييم
    doc.fontSize(11)
       .font('Helvetica-Bold')
       .fillColor('#1F2937')
       .text('Performance Criteria', 50, 325);
    
    doc.rect(50, 345, 500, 20).fill('#F3F4F6');
    doc.fillColor('#374151')
       .fontSize(9)
       .font('Helvetica-Bold')
       .text('Criteria', 60, 350)
       .text('Rating (1-5)', 300, 350)
       .text('Comments', 400, 350);
    
    const criteria = [
      'Quality of Work', 'Technical Skills', 'Communication',
      'Teamwork', 'Punctuality', 'Initiative', 'Adaptability', 'Overall Performance'
    ];
    
    let y = 370;
    criteria.forEach((crit) => {
      doc.fillColor('#1F2937')
         .font('Helvetica')
         .fontSize(9)
         .text(crit, 60, y);
      
      for (let i = 1; i <= 5; i++) {
        doc.rect(280 + (i * 20), y - 2, 12, 12).stroke('#D1D5DB');
        doc.fillColor('#6B7280').fontSize(7).text(i, 284 + (i * 20), y);
      }
      
      doc.rect(400, y - 2, 140, 15).stroke('#E5E7EB');
      y += 25;
    });
    
    // ملاحظات
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1F2937').text('General Comments', 50, 570);
    doc.rect(50, 590, 500, 50).stroke('#E5E7EB');
    
    // توصيات
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1F2937').text('Recommendation', 50, 660);
    const recs = ['☐ Extend', '☐ Hire', '☐ Complete', '☐ Improve'];
    let rx = 70;
    recs.forEach(r => { doc.fontSize(9).fillColor('#374151').text(r, rx, 680); rx += 100; });
    
    // توقيعات
    doc.moveTo(50, 720).lineTo(250, 720).stroke('#4F46E5');
    doc.moveTo(350, 720).lineTo(550, 720).stroke('#4F46E5');
    doc.fontSize(8).fillColor('#374151')
      .text('Supervisor Signature', 50, 730)
      .text('Date: ___________', 50, 745)
      .text('Student Signature', 350, 730)
      .text('Date: ___________', 350, 745);
    
    doc.end();
    
    writeStream.on('finish', () => {
      console.log(`✅ Evaluation Form saved: ${filePath}`);
      res.download(filePath, fileName);
    });
    
  } catch (error) {
    console.error('🔥 Error generating evaluation form:', error);
    res.status(500).json({ success: false, message: 'Error generating evaluation form' });
  }
});


app.post('/api/admin/acceptance-letter/generate', protect, async (req, res) => {
  try {
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const { studentName, companyName, internshipTitle, agreementId } = req.body;

    // جلب بيانات إضافية
    const [agreements] = await db.execute(`
      SELECT a.created_at, i.start_date, i.stipend, i.duration, i.end_date
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      WHERE a.id = ?
    `, [agreementId]);
    
    let startDate = '13 April 2026';
    let stipend = '22,000.00 DZD/month';
    let duration = '4 months';
    
    if (agreements.length > 0) {
      const agreement = agreements[0];
      if (agreement.start_date) {
        startDate = new Date(agreement.start_date).toLocaleDateString('en-GB', {
          year: 'numeric', month: 'long', day: 'numeric'
        });
      }
      if (agreement.stipend) {
        stipend = `${agreement.stipend.toLocaleString()} DZD/month`;
      }
      if (agreement.duration) {
        duration = `${agreement.duration} months`;
      }
    }
    
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const fs = require('fs');
    const path = require('path');
    
    const uploadDir = path.join(__dirname, 'uploads', 'acceptance_letters');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const fileName = `acceptance_${studentName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);
    
    // ========== تصميم صفحة واحدة ==========
    
    // الإطار الخارجي
    doc.rect(30, 30, 540, 780).lineWidth(1).stroke('#CCCCCC');
    
    // ========== الجزء العلوي (مثل تصميم الشهادة) ==========

// شعار الجامعة (أعلى يسار)
const logoPath = path.join(__dirname, 'uploads', 'logo-univ.png');
if (fs.existsSync(logoPath)) {
  doc.image(logoPath, 50, 50, { width: 60, height: 60 });
}

// شعار STAG في المنتصف
doc.fontSize(22)
   .font('Helvetica-Bold')
   .fillColor('#4F46E5')
   .text('STAG', 0, 70, { align: 'center' });

// النص الوصفي تحت STAG
doc.fontSize(9)
   .font('Helvetica')
   .fillColor('#888888')
   .text('Internship & Matching Platform', 0, 95, { align: 'center' });

// خط فاصل زخرفي
doc.moveTo(150, 115).lineTo(460, 115).lineWidth(0.5).stroke('#CCCCCC');
    
    // Ref و Date
    const refNumber = `ACC-${Date.now().toString().slice(-8)}`;
    const currentDate = new Date().toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    
    doc.fillColor('#666666').fontSize(9).font('Helvetica')
      .text(`Ref: ${refNumber}`, 420, 120)
      .text(`Date: ${currentDate}`, 420, 135);
    
    // عنوان الخطاب
    doc.fillColor('#1F2937').fontSize(22).font('Helvetica-Bold')
      .text('ACCEPTANCE LETTER', 0, 165, { align: 'center' });
    doc.fillColor('#666666').fontSize(11).font('Helvetica')
      .text('Official Internship Offer', 0, 190, { align: 'center' });
    doc.moveTo(200, 210).lineTo(410, 210).lineWidth(0.5).stroke('#4F46E5');
    
    // TO Box
    doc.roundedRect(50, 230, 250, 85, 8).fillAndStroke('#F9FAFB', '#E5E7EB');
    doc.fillColor('#1F2937').fontSize(10).font('Helvetica-Bold').text('TO:', 65, 245);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#4F46E5').text(studentName, 65, 265);
    doc.fontSize(9).font('Helvetica').fillColor('#374151')
      .text('Student, Computer Science Department', 65, 290)
      .text('University of Constantine', 65, 305);
    
    // FROM Box
    doc.roundedRect(320, 230, 230, 85, 8).fillAndStroke('#F9FAFB', '#E5E7EB');
    doc.fillColor('#1F2937').fontSize(10).font('Helvetica-Bold').text('FROM:', 335, 245);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#4F46E5').text(companyName, 335, 265);
    doc.fontSize(9).font('Helvetica').fillColor('#374151')
      .text('HR Department', 335, 290)
      .text('Internship Coordinator', 335, 305);
    
    // نص الخطاب
    let yPos = 345;
    doc.fillColor('#374151').fontSize(11).font('Helvetica').text(`Dear ${studentName},`, 50, yPos);
    yPos += 28;
    
    doc.text('We are pleased to inform you that you have been selected for the internship position at our company.', 50, yPos, { width: 500 });
    yPos += 22;
    doc.text('After careful review of your application and interview performance, we were impressed with your', 50, yPos, { width: 500 });
    yPos += 18;
    doc.text('qualifications and believe you will be a valuable addition to our team.', 50, yPos, { width: 500 });
    yPos += 25;
    doc.text('We would like to offer you the position of:', 50, yPos, { width: 500 });
    yPos += 20;
    
    // عنوان التدريب (بدون مستطيل)
doc.fillColor('#4F46E5')
   .fontSize(16)
   .font('Helvetica-Bold')
   .text(`"${internshipTitle}"`, 0, yPos, { align: 'center' });
    
    yPos += 45;
    
    // جدول تفاصيل العرض (سطرين)
    doc.roundedRect(50, yPos, 500, 80, 8).fillAndStroke('#F9FAFB', '#E5E7EB');
    
    // السطر الأول
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#4B5563')
      .text('Start Date:', 70, yPos + 15);
    doc.font('Helvetica').fontSize(9).fillColor('#1F2937')
      .text(startDate, 145, yPos + 15);
    
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#4B5563')
      .text('Duration:', 290, yPos + 15);
    doc.font('Helvetica').fontSize(9).fillColor('#1F2937')
      .text(duration, 355, yPos + 15);
    
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#4B5563')
      .text('Working Hours:', 70, yPos + 38);
    doc.font('Helvetica').fontSize(9).fillColor('#1F2937')
      .text('9:00 AM - 4:00 PM', 160, yPos + 38);
    
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#4B5563')
      .text('Supervisor:', 290, yPos + 38);
    doc.font('Helvetica').fontSize(9).fillColor('#1F2937')
      .text('To be assigned', 365, yPos + 38);
    
    // السطر الثاني
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#4B5563')
      .text('Stipend:', 70, yPos + 61);
    doc.font('Helvetica').fontSize(9).fillColor('#1F2937')
      .text(stipend, 130, yPos + 61);
    
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#4B5563')
      .text('Location:', 290, yPos + 61);
    doc.font('Helvetica').fontSize(9).fillColor('#1F2937')
      .text(companyName, 355, yPos + 61);
    
    yPos += 100;
    
    // المستندات المطلوبة
    doc.fillColor('#1F2937').fontSize(11).font('Helvetica-Bold').text('Required Documents:', 50, yPos);
    yPos += 18;
    
    const documents = [
      '✓ Valid National ID or Passport',
      '✓ University enrollment certificate',
      '✓ Signed internship agreement (3 copies)',
      '✓ 2 passport-sized photos',
      '✓ Bank account details (RIB)'
    ];
    
    documents.forEach((docText) => {
      doc.font('Helvetica').fontSize(9).fillColor('#374151').text(docText, 70, yPos);
      yPos += 18;
    });
    
    yPos += 15;
    
    // نص ختامي
    doc.font('Helvetica').fontSize(11).fillColor('#374151')
      .text('We look forward to welcoming you to our team!', 50, yPos);
    
    yPos += 30;
    
    // توقيع
    //doc.moveTo(350, yPos).lineTo(520, yPos).lineWidth(1.5).stroke('#4F46E5');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#1F2937').text('HR Department', 350, yPos + 12);
    doc.fontSize(8).font('Helvetica').fillColor('#4F46E5').text(companyName, 350, yPos + 24);
    
    // Document Number
    doc.fillColor('#9CA3AF').fontSize(7).font('Helvetica')
      .text(`Document No: ACC-${Date.now().toString().slice(-8)}`, 50, 770);
    
    doc.end();
    
    writeStream.on('finish', () => {
      console.log(`✅ Acceptance Letter saved: ${filePath}`);
      res.download(filePath, fileName);
    });
    
    writeStream.on('error', (err) => {
      console.error('Error:', err);
      res.status(500).json({ success: false, message: 'Error saving acceptance letter' });
    });
    
  } catch (error) {
    console.error('🔥 Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});



// Admin Notifications
app.get('/api/admin/notifications', protect, async (req, res) => {
  try {
    // Verify user is admin
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const [notifications] = await db.execute(
      `SELECT * FROM admin_notifications 
       ORDER BY created_at DESC`,
      []
    );

    res.json({
      success: true,
      notifications
    });

  } catch (error) {
    console.error('🔥 Error fetching admin notifications:', error);
    res.json({ 
      success: true, 
      notifications: [] 
    });
  }
});


app.put('/api/admin/notifications/:id/read', protect, async (req, res) => {
  try {
    // Verify user is admin
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const notificationId = req.params.id;

    const [result] = await db.execute(
      'UPDATE admin_notifications SET is_read = 1 WHERE id = ?',
      [notificationId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('🔥 Error marking notification:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification'
    });
  }
});


app.put('/api/admin/notifications/read-all', protect, async (req, res) => {
  try {
    // Verify user is admin
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    // ✅ الأفضل: تحديث فقط غير المقروءة
    const [result] = await db.execute(
      'UPDATE admin_notifications SET is_read = 1 WHERE is_read = 0'
    );

    res.json({
      success: true,
      message: 'All notifications marked as read',
      updated_count: result.affectedRows  // كم عدد الذي تم تحديثه
    });

  } catch (error) {
    console.error('🔥 Error marking all notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notifications'
    });
  }
});


app.put('/api/admin/notifications/:id/update-data', protect, async (req, res) => {
  try {
    // Verify user is admin
    if (req.user.user_type !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin only.' 
      });
    }

    const notificationId = req.params.id;
    const updateData = req.body; // { validated: true } أو { agreement_generated: true }

    // جلب الإشعار الحالي
    const [notifications] = await db.execute(
      'SELECT data FROM admin_notifications WHERE id = ?',
      [notificationId]
    );

    if (notifications.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // دمج البيانات الجديدة مع القديمة
    let currentData = {};
    try {
      currentData = JSON.parse(notifications[0].data || '{}');
    } catch (e) {
      currentData = {};
    }

    const newData = { ...currentData, ...updateData };
    const dataString = JSON.stringify(newData);

    // تحديث البيانات
    await db.execute(
      'UPDATE admin_notifications SET data = ? WHERE id = ?',
      [dataString, notificationId]
    );

    res.json({
      success: true,
      message: 'Notification data updated successfully'
    });

  } catch (error) {
    console.error('🔥 Error updating notification data:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification data'
    });
  }
});



// 🔔 NOTIFICATION ROUTES (Shared)
app.post('/api/notifications/send', protect, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { user_id, user_type, type, title, message, application_id, ...rest } = req.body;
    
    console.log('📨 Sending notification:', { user_type, type, title });
    
    // تحضير البيانات الإضافية
    const data = JSON.stringify(rest || {});
    let result;
    
    // إرسال حسب نوع المستخدم
    switch(user_type) {
      case 'student':
        if (!user_id) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ 
            success: false, 
            message: 'user_id is required for student notifications' 
          });
        }
        
        [result] = await connection.execute(
          `INSERT INTO notifications 
           (user_id, type, title, message, application_id, data, is_read, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, 0, NOW())`,
          [user_id, type, title, message, application_id, data]
        );
        break;

      case 'admin':
        [result] = await connection.execute(
          `INSERT INTO admin_notifications 
           (type, title, message, application_id, data, is_read, created_at) 
           VALUES (?, ?, ?, ?, ?, 0, NOW())`,
          [type, title, message, application_id, data]
        );
        break;

      case 'company':
        if (!user_id) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ 
            success: false, 
            message: 'user_id is required for company notifications' 
          });
        }
        
        [result] = await connection.execute(
          `INSERT INTO company_notifications 
           (company_id, type, title, message, application_id, data, is_read, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, 0, NOW())`,
          [user_id, type, title, message, application_id, data]
        );
        break;

      default:
        await connection.rollback();
        connection.release();
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid user_type. Must be student, admin, or company.' 
        });
    }
    
    await connection.commit();
    connection.release();
    
    res.json({ 
      success: true, 
      message: 'Notification sent successfully',
      notificationId: result?.insertId 
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    
    console.error('❌ Error sending notification:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error sending notification',
      error: error.message 
    });
  }
});


app.put('/api/agreements/:agreementId/complete', protect, async (req, res) => {
  try {
    const agreementId = req.params.agreementId;
    
    const [result] = await db.execute(
      `UPDATE agreements 
       SET status = 'completed', 
           completed_at = NOW() 
       WHERE id = ?`,
      [agreementId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Agreement completed successfully' 
    });
    
  } catch (error) {
    console.error('Error completing agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});


app.post('/api/agreements/regenerate-pdf', protect, async (req, res) => {
  try {
    const { agreementId } = req.body;
    
    console.log('📄 Generating PDF for agreement:', agreementId);
    
    // جلب بيانات الاتفاقية مع التوقيعات
    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.student_signed,
        a.company_signed,
        a.university_signed,
        a.signature_url,
        a.company_signature_url,
        a.university_signature_url,
        a.signature_type,
        a.company_signature_type,
        a.university_signature_type,
        a.typed_name,
        a.company_typed_name,
        a.university_typed_name,
        a.signed_at,
        a.completed_at,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.university,
        c.company_name,
        i.title as internship_title,
        i.description,
        i.duration,
        i.stipend,
        i.start_date,
        i.end_date
      FROM agreements a
      JOIN students s ON a.student_id = s.user_id
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE a.id = ?
    `, [agreementId]);
    
    if (agreements.length === 0) {
      return res.status(404).json({ success: false, message: 'Agreement not found' });
    }
    
    const agreement = agreements[0];
    
    // توليد PDF
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    const chunks = [];
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    
    // ========== HEADER ==========
    doc.fontSize(20)
       .font('Helvetica-Bold')
       .text('INTERNSHIP AGREEMENT', { align: 'center' });
    
    doc.moveDown();
    doc.fontSize(10)
       .font('Helvetica')
       .text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
    
    doc.moveDown(2);
    
    // ========== PARTIES ==========
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('This Agreement is made between:');
    
    doc.moveDown();
    
    // Company Section
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('THE COMPANY');
    doc.font('Helvetica')
       .text(`Name: ${agreement.company_name}`);
    doc.text('(Hereinafter referred to as "The Company")');
    
    doc.moveDown();
    
    // Student Section
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('THE STUDENT');
    doc.font('Helvetica')
       .text(`Name: ${agreement.student_name}`);
    doc.text(`University: ${agreement.university}`);
    
    doc.moveDown();
    
    // Internship Position
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('INTERNSHIP POSITION');
    doc.font('Helvetica')
       .text(agreement.internship_title);
    
    doc.moveDown(2);
    
    // ========== TERMS AND CONDITIONS ==========
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('TERMS AND CONDITIONS');
    
    doc.moveDown();
    
    const terms = [
      '1. The student agrees to complete the internship period as specified in this agreement.',
      '2. The company agrees to provide necessary training, supervision, and resources.',
      '3. The university agrees to oversee the internship progress and provide academic supervision.',
      '4. Both parties agree to maintain confidentiality of any proprietary information.',
      '5. The internship will commence on the start date and continue for the agreed duration.',
      '6. Either party may terminate this agreement with 7 days written notice.',
      '7. The student agrees to abide by the company\'s policies and regulations.'
    ];
    
    terms.forEach(term => {
      doc.fontSize(9)
         .font('Helvetica')
         .text(term);
      doc.moveDown(0.5);
    });
    
    doc.moveDown(2);
    
    // ========== SIGNATURES SECTION ==========
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('SIGNATURES');
    
    doc.moveDown();
    
    // ==========================================
    // 1. COMPANY SIGNATURE
    // ==========================================
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('Company Representative:');
    
    if (agreement.company_signed) {
      // عرض صورة توقيع الشركة
      if (agreement.company_signature_url) {
        try {
          const signaturePath = path.join(__dirname, agreement.company_signature_url);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 50, doc.y, { width: 150 });
            doc.moveDown(3);
          } else {
            doc.font('Helvetica')
               .text('✓ Signed (Signature image not found)', 50, doc.y);
            doc.moveDown();
          }
        } catch (err) {
          doc.font('Helvetica')
             .text('✓ Signed (Signature not available)', 50, doc.y);
          doc.moveDown();
        }
      } else if (agreement.company_typed_name) {
        // إذا كان توقيع كتابة
        doc.font('Helvetica')
           .text(`✓ Signed: ${agreement.company_typed_name}`, 50, doc.y);
        doc.moveDown();
      } else {
        doc.font('Helvetica')
           .text('✓ Signed', 50, doc.y);
        doc.moveDown();
      }
      doc.text(`Date: ${new Date(agreement.signed_at).toLocaleDateString()}`);
    } else {
      doc.font('Helvetica')
         .text('_________________________');
      doc.text('Name: ___________________');
    }
    
    doc.moveDown(2);
    
    // ==========================================
    // 2. STUDENT SIGNATURE
    // ==========================================
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('Student:');
    
    if (agreement.student_signed) {
      // عرض صورة توقيع الطالب
      if (agreement.signature_url) {
        try {
          const signaturePath = path.join(__dirname, agreement.signature_url);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 50, doc.y, { width: 150 });
            doc.moveDown(3);
          } else {
            doc.font('Helvetica')
               .text('✓ Signed (Signature image not found)', 50, doc.y);
            doc.moveDown();
          }
        } catch (err) {
          doc.font('Helvetica')
             .text('✓ Signed (Signature not available)', 50, doc.y);
          doc.moveDown();
        }
      } else if (agreement.typed_name) {
        // إذا كان توقيع كتابة
        doc.font('Helvetica')
           .text(`✓ Signed: ${agreement.typed_name}`, 50, doc.y);
        doc.moveDown();
      } else {
        doc.font('Helvetica')
           .text('✓ Signed', 50, doc.y);
        doc.moveDown();
      }
      doc.text(`Name: ${agreement.student_name}`);
      doc.text(`Date: ${new Date(agreement.signed_at).toLocaleDateString()}`);
    } else {
      doc.font('Helvetica')
         .text('_________________________');
      doc.text(`Name: ${agreement.student_name}`);
    }
    
    doc.moveDown(2);
    
    // ==========================================
    // 3. UNIVERSITY SIGNATURE
    // ==========================================
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('University Supervisor:');
    
    if (agreement.university_signed) {
      // عرض صورة توقيع الجامعة
      if (agreement.university_signature_url) {
        try {
          const signaturePath = path.join(__dirname, agreement.university_signature_url);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 50, doc.y, { width: 150 });
            doc.moveDown(3);
          } else {
            doc.font('Helvetica')
               .text('✓ Signed (Signature image not found)', 50, doc.y);
            doc.moveDown();
          }
        } catch (err) {
          doc.font('Helvetica')
             .text('✓ Signed (Signature not available)', 50, doc.y);
          doc.moveDown();
        }
      } else if (agreement.university_typed_name) {
        // إذا كان توقيع كتابة
        doc.font('Helvetica')
           .text(`✓ Signed: ${agreement.university_typed_name}`, 50, doc.y);
        doc.moveDown();
      } else {
        doc.font('Helvetica')
           .text('✓ Signed', 50, doc.y);
        doc.moveDown();
      }
      doc.text(`Date: ${new Date(agreement.completed_at || agreement.signed_at).toLocaleDateString()}`);
    } else {
      doc.font('Helvetica')
         .text('_________________________');
      doc.text('Name: ___________________');
    }
    
    doc.moveDown(2);
    
    // ========== FOOTER ==========
    doc.fontSize(8)
       .fillColor('#9CA3AF')
       .text('This agreement is legally binding upon signature by all parties.', { align: 'center' })
       .text(`Generated by STAG Platform on ${new Date().toLocaleDateString()}`, { align: 'center' });
    
    doc.end();
    
    const pdfBuffer = await pdfPromise;
    
    // حفظ الملف
    const fileName = `agreement_${agreementId}_${Date.now()}.pdf`;
    const uploadDir = path.join(__dirname, 'uploads', 'agreements');
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const filePath = path.join(uploadDir, fileName);
    await fs.writeFile(filePath, pdfBuffer);
    
    // تحديث مسار PDF في قاعدة البيانات
    await db.execute(
      'UPDATE agreements SET pdf_url = ? WHERE id = ?',
      [`/uploads/agreements/${fileName}`, agreementId]
    );
    
    // إرسال الملف
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('🔥 Error generating PDF:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error generating PDF',
      error: error.message 
    });
  }
});



// 📄 PDF GENERATION FUNCTIONS
const generateConventionDeStagePDF = (data, res) => {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      
      doc.pipe(res);

      // ✅ إضافة شعار الجامعة في أعلى اليسار
      const logoPath = path.join(__dirname, 'uploads', 'logo-univ.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, 30, { width: 60, height: 60 });
        console.log('✅ University logo added to PDF');
      } else {
        console.log('⚠️ Logo file not found:', logoPath);
      }
      
      let yPos = 80;

      
      doc.fontSize(20).font('Helvetica-Bold').text('INTERNSHIP AGREEMENT', 0, yPos, { align: 'center' });
      yPos += 60;
      
      const boxWidth = 230;
      const boxHeight = 120;
      const leftBoxX = 50;
      const rightBoxX = 300;
      let boxesY = yPos;
      
      // ENTRE above left box
      doc.fontSize(11).font('Helvetica-Bold').text('BETWEEN', leftBoxX + 10, boxesY - 15);
      
      // LEFT BOX: UNIVERSITY
      doc.rect(leftBoxX, boxesY, boxWidth, boxHeight).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text("L'UNIVERSITE DE CONSTANTINE 2", leftBoxX + 10, boxesY + 8);
      
      let uniY = boxesY + 28;
      doc.fontSize(8).font('Helvetica')
        .text('Abdelhamid Mehri', leftBoxX + 15, uniY);
      uniY += 14;
      doc.text('The Vice-Rector in charge of', leftBoxX + 15, uniY);
      uniY += 12;
      doc.text('External Relations, hereinafter referred to as', leftBoxX + 15, uniY);
      uniY += 12;
      doc.text('the university', leftBoxX + 15, uniY);
      uniY += 14;
      doc.text('Tel/Fax: 021 30 31 82 / 4579', leftBoxX + 15, uniY);
      
      // ET above right box
      doc.fontSize(11).font('Helvetica-Bold').text('AND', rightBoxX + 10, boxesY - 15);
      
      // RIGHT BOX: COMPANY
      doc.rect(rightBoxX, boxesY, boxWidth, boxHeight).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text("The company (name and address)", rightBoxX + 10, boxesY + 8);
      
      let companyY = boxesY + 28;
      doc.fontSize(8).font('Helvetica')
        .text(data.companyName || '___________________', rightBoxX + 15, companyY);
      companyY += 14;
      doc.text(data.companyAddress || '___________________', rightBoxX + 15, companyY);
      companyY += 14;
      doc.text(`Represented by: ${data.companyRepresentative || '___________________'}`, rightBoxX + 15, companyY);
      companyY += 14;
      doc.text(`Tel/Fax: ${data.companyPhone || '___________________'}`, rightBoxX + 15, companyY);
      
      yPos = boxesY + boxHeight + 20;
      
      // STUDENT SECTION
      const studentBoxHeight = 150;
      doc.rect(50, yPos, 500, studentBoxHeight).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text("THE STUDENT", 60, yPos + 8);
      
      let studentY = yPos + 28;
      doc.fontSize(8).font('Helvetica')
        .text(`First and last name: ${data.studentName || '___________________'}`, 70, studentY);
      studentY += 15;
      doc.text(`Student ID card number: ${data.studentId || '___________________'}`, 70, studentY);
      studentY += 15;
      doc.text(`Social Security Number: ${data.socialSecurity || '___________________'}`, 70, studentY);
      studentY += 15;
      doc.text(`Tel: ${data.studentPhone || '___________________'}`, 70, studentY);
      
      yPos = yPos + studentBoxHeight + 15;
      
      // STAGE DETAILS SECTION
      const stageBoxHeight = 130;
      doc.rect(50, yPos, 500, stageBoxHeight).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text("INTERNSHIP DATA", 60, yPos + 8);
      
      let stageY = yPos + 28;
      doc.fontSize(8).font('Helvetica')
      .text(`Internship topic: ${data.internshipTitle || '___________________'}`, 70, stageY);
      stageY += 15;
      doc.text(`Academic supervisor: ${data.supervisor || '___________________'}`, 70, stageY);
      stageY += 15;
      doc.text(`Internship duration: ${data.duration || '3'} months`, 70, stageY);
      stageY += 15;
      
      const startDateFormatted = data.startDate ? new Date(data.startDate).toLocaleDateString('en-GB') : '___________________';
      const endDateFormatted = data.endDate ? new Date(data.endDate).toLocaleDateString('en-GB') : '___________________';

      doc.text(`Internship start date: ${startDateFormatted}`, 70, stageY);
      stageY += 15;
      doc.text(`Internship end date: ${endDateFormatted}`, 70, stageY);
      
      yPos = yPos + stageBoxHeight + 20;
      
      // FOOTER
      doc.fontSize(8).font('Helvetica').text(
        'Prepared in 02 original copies: 1 copy for the university and 01 copy for the company', 
        50, yPos, { align: 'center' }
      );
      yPos += 18;
      
      const currentDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
      doc.text(`Done at Constantine on: ${currentDate}`, 50, yPos);
      yPos += 25;
      
            // ==========================================
      // ✅ SECTION DES SIGNATURES (3 SIGNATURES)
      // Ordre: Université → Entreprise → Étudiant
      // ==========================================
      const sigWidth = 155;
      const sigHeight = 55;
      
      // 📌 1. SIGNATURE DE L'UNIVERSITÉ (University Signature) - الأول
      doc.rect(50, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the university", 58, yPos + 6);
      if (data.universitySignature) {
        try {
          const fs = require('fs');
          const path = require('path');
          const signaturePath = path.join(__dirname, data.universitySignature);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 58, yPos + 18, { width: 100, height: 25 });
          } else {
            doc.fontSize(8).font('Helvetica').text('___________________', 58, yPos + 22);
          }
        } catch (err) {
          doc.fontSize(8).font('Helvetica').text('___________________', 58, yPos + 22);
        }
      } else {
        doc.fontSize(8).font('Helvetica').text('___________________', 58, yPos + 22);
      }
      
      
      // 📌 2. SIGNATURE DE L'ENTREPRISE (Company Signature) - الثاني
      doc.rect(225, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the company", 233, yPos + 6);
      if (data.companySignature) {
        try {
          const fs = require('fs');
          const path = require('path');
          const signaturePath = path.join(__dirname, data.companySignature);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 233, yPos + 18, { width: 100, height: 25 });
          } else {
            doc.fontSize(8).font('Helvetica').text('___________________', 233, yPos + 22);
          }
        } catch (err) {
          doc.fontSize(8).font('Helvetica').text('___________________', 233, yPos + 22);
        }
      } else {
        doc.fontSize(8).font('Helvetica').text('___________________', 233, yPos + 22);
      }
      
      
      // 📌 3. SIGNATURE DE L'ÉTUDIANT (Student Signature) - الثالث
      doc.rect(400, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the student", 408, yPos + 6);
      if (data.studentSignature) {
        try {
          const fs = require('fs');
          const path = require('path');
          const signaturePath = path.join(__dirname, data.studentSignature);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 408, yPos + 18, { width: 100, height: 25 });
          } else {
            doc.fontSize(8).font('Helvetica').text('___________________', 408, yPos + 22);
          }
        } catch (err) {
          doc.fontSize(8).font('Helvetica').text('___________________', 408, yPos + 22);
        }
      } else {
        doc.fontSize(8).font('Helvetica').text('___________________', 408, yPos + 22);
      }
      
      doc.end();
      
      doc.on('finish', () => resolve(true));
      doc.on('error', reject);
      
    } catch (error) {
      reject(error);
    }
  });
};


const generateEnglishAgreementPDF = (data, res) => {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      
      doc.pipe(res);
      
      // إضافة شعار الجامعة
      const logoPath = path.join(__dirname, 'uploads', 'logo-univ.png');
      if (fs.existsSync(logoPath)) {
        //doc.image(logoPath, 40, 30, { width: 60, height: 60 });
        doc.image(logoPath, 40, 35, { width: 100 });
      }
      
      //let yPos = 80;
      let yPos = 120;
      
      doc.fontSize(20).font('Helvetica-Bold').text('INTERNSHIP AGREEMENT', 0, yPos, { align: 'center' });
      yPos += 60;
      
      const boxWidth = 230;
      const boxHeight = 120;
      const leftBoxX = 50;
      const rightBoxX = 300;
      let boxesY = yPos;
      
      doc.fontSize(11).font('Helvetica-Bold').text('BETWEEN', leftBoxX + 10, boxesY - 15);
      
      // LEFT BOX: UNIVERSITY
      doc.rect(leftBoxX, boxesY, boxWidth, boxHeight).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text("L'UNIVERSITE DE CONSTANTINE 2", leftBoxX + 10, boxesY + 8);
      
      let uniY = boxesY + 28;
      doc.fontSize(8).font('Helvetica')
        .text('Abdelhamid Mehri', leftBoxX + 15, uniY);
      uniY += 14;
      doc.text('The Vice-Rector in charge of', leftBoxX + 15, uniY);
      uniY += 12;
      doc.text('External Relations, hereinafter referred to as', leftBoxX + 15, uniY);
      uniY += 12;
      doc.text('the university', leftBoxX + 15, uniY);
      uniY += 14;
      doc.text('Tel/Fax: 021 30 31 82 / 4579', leftBoxX + 15, uniY);
      
      doc.fontSize(11).font('Helvetica-Bold').text('AND', rightBoxX + 10, boxesY - 15);
      
      // RIGHT BOX: COMPANY
      doc.rect(rightBoxX, boxesY, boxWidth, boxHeight).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text("The company (name and address)", rightBoxX + 10, boxesY + 8);
      
      let companyY = boxesY + 28;
      doc.fontSize(8).font('Helvetica')
        .text(data.companyName || '___________________', rightBoxX + 15, companyY);
      companyY += 14;
      doc.text(data.companyAddress || '___________________', rightBoxX + 15, companyY);
      companyY += 14;
      doc.text(`Represented by: ${data.companyRepresentative || '___________________'}`, rightBoxX + 15, companyY);
      companyY += 14;
      doc.text(`Tel/Fax: ${data.companyPhone || '___________________'}`, rightBoxX + 15, companyY);
      
      yPos = boxesY + boxHeight + 20;
      
      // STUDENT SECTION
      const studentBoxHeight = 150;
      doc.rect(50, yPos, 500, studentBoxHeight).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text("THE STUDENT", 60, yPos + 8);
      
      let studentY = yPos + 28;
      doc.fontSize(8).font('Helvetica')
        .text(`First and last name: ${data.studentName || '___________________'}`, 70, studentY);
      studentY += 15;
      doc.text(`Student ID card number: ${data.studentId || '___________________'}`, 70, studentY);
      studentY += 15;
      doc.text(`Social Security Number: ${data.socialSecurity || '___________________'}`, 70, studentY);
      studentY += 15;
      doc.text(`Tel: ${data.studentPhone || '___________________'}`, 70, studentY);
      
      yPos = yPos + studentBoxHeight + 15;
      
      // INTERNSHIP DATA SECTION
      const stageBoxHeight = 130;
      doc.rect(50, yPos, 500, stageBoxHeight).stroke();
      doc.fontSize(9).font('Helvetica-Bold').text("INTERNSHIP DATA", 60, yPos + 8);
      
      let stageY = yPos + 28;
      doc.fontSize(8).font('Helvetica')
        .text(`Internship topic: ${data.internshipTitle || '___________________'}`, 70, stageY);
      stageY += 15;
      doc.text(`Academic supervisor: ${data.supervisor || '___________________'}`, 70, stageY);
      stageY += 15;
      doc.text(`Internship duration: ${data.duration || '3'} months`, 70, stageY);
      stageY += 15;
      
      const startDateFormatted = data.startDate ? new Date(data.startDate).toLocaleDateString('en-GB') : '___________________';
      const endDateFormatted = data.endDate ? new Date(data.endDate).toLocaleDateString('en-GB') : '___________________';

      doc.text(`Internship start date: ${startDateFormatted}`, 70, stageY);
      stageY += 15;
      doc.text(`Internship end date: ${endDateFormatted}`, 70, stageY);
      
      yPos = yPos + stageBoxHeight + 20;
      
      // FOOTER
      doc.fontSize(8).font('Helvetica').text(
        'Prepared in 02 original copies: 1 copy for the university and 01 copy for the company', 
        50, yPos, { align: 'center' }
      );
      yPos += 18;
      
      const currentDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
      doc.text(`Done at Constantine on: ${currentDate}`, 50, yPos);
      yPos += 25;
      
      // SIGNATURES
      const sigWidth = 155;
      const sigHeight = 55;
      
      doc.rect(50, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the university", 58, yPos + 6);
      if (data.universitySignature) {
        try {
          const signaturePath = path.join(__dirname, data.universitySignature);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 58, yPos + 18, { width: 100, height: 25 });
          } else {
            doc.fontSize(8).font('Helvetica').text('___________________', 58, yPos + 22);
          }
        } catch (err) {
          doc.fontSize(8).font('Helvetica').text('___________________', 58, yPos + 22);
        }
      } else {
        doc.fontSize(8).font('Helvetica').text('___________________', 58, yPos + 22);
      }
      
      doc.rect(225, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the company", 233, yPos + 6);
      if (data.companySignature) {
        try {
          const signaturePath = path.join(__dirname, data.companySignature);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 233, yPos + 18, { width: 100, height: 25 });
          } else {
            doc.fontSize(8).font('Helvetica').text('___________________', 233, yPos + 22);
          }
        } catch (err) {
          doc.fontSize(8).font('Helvetica').text('___________________', 233, yPos + 22);
        }
      } else {
        doc.fontSize(8).font('Helvetica').text('___________________', 233, yPos + 22);
      }
      
      doc.rect(400, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the student", 408, yPos + 6);
      if (data.studentSignature) {
        try {
          const signaturePath = path.join(__dirname, data.studentSignature);
          if (fs.existsSync(signaturePath)) {
            doc.image(signaturePath, 408, yPos + 18, { width: 100, height: 25 });
          } else {
            doc.fontSize(8).font('Helvetica').text('___________________', 408, yPos + 22);
          }
        } catch (err) {
          doc.fontSize(8).font('Helvetica').text('___________________', 408, yPos + 22);
        }
      } else {
        doc.fontSize(8).font('Helvetica').text('___________________', 408, yPos + 22);
      }
      
      doc.end();
      
      doc.on('finish', () => resolve(true));
      doc.on('error', reject);
      
    } catch (error) {
      reject(error);
    }
  });
};



// 📧 NOTIFICATION HELPER FUNCTIONS
const notifyAgreementGenerated = async (agreementId, studentId, companyId, internshipTitle, studentName, companyName) => {
  try {
    const connection = await db.getConnection();
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, agreement_id, student_id, company_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'agreement_generated',
        '📄 Agreement Generated',
        `Internship agreement for ${studentName} at ${companyName} (${internshipTitle}) has been generated.`,
        agreementId,
        studentId,
        companyId
      ]
    );
    connection.release();
    console.log('✅ Agreement generated notification created');
  } catch (error) {
    console.error('Error creating agreement notification:', error);
  }
};


const notifyAgreementSigned = async (agreementId, studentId, studentName, companyId, companyName, internshipTitle, signedAt) => {
  try {
    const connection = await db.getConnection();
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, agreement_id, student_id, company_id, signed_at, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        'agreement_signed',
        '✍️ Agreement Signed',
        `${studentName} has signed the agreement for ${internshipTitle} at ${companyName}.`,
        agreementId,
        studentId,
        companyId,
        signedAt || new Date()
      ]
    );
    connection.release();
    console.log('✅ Agreement signed notification created');
  } catch (error) {
    console.error('Error creating signed agreement notification:', error);
  }
};


const notifyCompanyRated = async (studentId, studentName, companyId, companyName, rating, review, internshipId) => {
  try {
    const connection = await db.getConnection();
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, student_id, company_id, internship_id, rating, review, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        'company_rated',
        '⭐ Company Rated',
        `${studentName} rated ${companyName} ${rating}/5 stars.`,
        studentId,
        companyId,
        internshipId,
        rating,
        review || ''
      ]
    );
    connection.release();
    console.log('✅ Company rated notification created');
  } catch (error) {
    console.error('Error creating rating notification:', error);
  }
};



// ⏰ SCHEDULED TASKS
const checkCompletedInternships = async () => {
  const connection = await db.getConnection();
  
  try {
    console.log('🔍 Checking for completed internships...');
    
    // البحث عن الاتفاقيات التي انتهت مدتها
    const [completed] = await connection.execute(`
      SELECT 
        a.id as agreement_id,
        a.student_id,
        a.internship_id,
        a.status,
        a.created_at,
        i.title as internship_title,
        i.company_id,
        i.duration,
        DATE_ADD(a.created_at, INTERVAL i.duration MONTH) as end_date,
        c.company_name,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        u.email as student_email
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      JOIN users u ON s.user_id = u.id
      WHERE a.status = 'active' 
        AND DATE_ADD(a.created_at, INTERVAL i.duration MONTH) <= CURDATE()
        AND a.id NOT IN (SELECT agreement_id FROM internship_completions)
    `);
    
    console.log(`📊 Found ${completed.length} completed internships`);
    
    for (const internship of completed) {
      await connection.beginTransaction();
      
      try {
        // تحديث حالة الاتفاقية
        await connection.execute(
          'UPDATE agreements SET status = "completed", completed_at = NOW() WHERE id = ?',
          [internship.agreement_id]
        );
        
        // تسجيل الإكمال في جدول منفصل (لمنع التكرار)
        await connection.execute(
          'INSERT INTO internship_completions (agreement_id, student_id, company_id, completed_at) VALUES (?, ?, ?, NOW())',
          [internship.agreement_id, internship.student_id, internship.company_id]
        );
        
        // إشعار للطالب
        await connection.execute(
          `INSERT INTO notifications 
           (user_id, type, title, message, agreement_id, created_at) 
           VALUES (?, 'internship_completed', ?, ?, ?, NOW())`,
          [
            internship.student_id,
            '🎓 Internship Completed!',
            `Congratulations! You have successfully completed your internship at ${internship.company_name} for "${internship.internship_title}".`,
            internship.agreement_id
          ]
        );
        
        // إشعار للإدارة
        await connection.execute(
          `INSERT INTO admin_notifications 
           (type, title, message, student_id, company_id, agreement_id, created_at) 
           VALUES ('internship_completed', ?, ?, ?, ?, ?, NOW())`,
          [
            '🎓 Internship Completed',
            `${internship.student_name} has completed internship at ${internship.company_name}`,
            internship.student_id,
            internship.company_id,
            internship.agreement_id
          ]
        );
        
        // إشعار للشركة
        await connection.execute(
          `INSERT INTO company_notifications 
           (company_id, type, title, message, agreement_id, created_at) 
           VALUES (?, 'internship_completed', ?, ?, ?, NOW())`,
          [
            internship.company_id,
            '🎓 Internship Completed',
            `${internship.student_name} has completed their internship at your company.`,
            internship.agreement_id
          ]
        );
        
        await connection.commit();
        console.log(`✅ Completed internship processed: ${internship.agreement_id}`);
        
      } catch (err) {
        await connection.rollback();
        console.error('❌ Error processing completion:', err);
      }
    }
    
  } catch (error) {
    console.error('🔥 Error checking completed internships:', error);
  } finally {
    connection.release();
  }
};

const scheduleCompletionCheck = () => {

  checkCompletedInternships();
  setInterval(checkCompletedInternships, 24 * 60 * 60 * 1000);
};

setTimeout(scheduleCompletionCheck, 5000);



// 🚀 SERVER STARTUP
const PORT = process.env.PORT || 5000;
//app.listen(PORT, async () =>
app.listen(PORT, async () => {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 STAG Platform Backend v3.0 - WITH COMPANY INTERNSHIPS!');
    console.log('='.repeat(70));
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`🔧 Port: ${PORT}`);
    console.log(`🗄️  Database: ${process.env.DB_NAME || 'stag_io_platform'}`);
    
    // Test database connection
    try {
        const [result] = await db.execute('SELECT 1 + 1 AS result');
        console.log(`✅ Database: Connected ✓`);
        
        // Check and update table structure automatically
        await db.checkAndUpdateTables();
        
    } catch (error) {
        console.log(`❌ Database: Not connected ✗ (${error.message})`);
    }
    
    console.log('\n' + '🏢 COMPANY ENDPOINTS '.padEnd(50, '-'));
    console.log('│ POST   /api/company/internships         - Create internship (PROTECTED)');
    console.log('│ GET    /api/company/internships         - Get company internships (PROTECTED)');
    
    console.log('\n' + '🎓 STUDENT ENDPOINTS '.padEnd(50, '-'));
    console.log('│ GET    /api/internships                 - Browse internships (PROTECTED)');
    console.log('│ POST   /api/student/applications        - Apply to internship (PROTECTED)');
    
    console.log('\n' + '👤 PROFILE ENDPOINTS '.padEnd(50, '-'));
    console.log('│ GET    /api/auth/me                    - Get user profile (PROTECTED)');
    console.log('│ PUT    /api/student/profile            - Update student profile (PROTECTED)');

    

console.log('\n' + '📋 APPLICATION ENDPOINTS '.padEnd(50, '-'));
console.log('│ GET    /api/student/applications           - Get student applications (PROTECTED)');
console.log('│ DELETE /api/student/applications/:id       - Withdraw application (PROTECTED)');
console.log('│ GET    /api/company/applications           - Get company applications (PROTECTED)');
console.log('│ PUT    /api/company/applications/:id/status - Update status (PROTECTED)');

// In the server startup section, add:
console.log('\n' + '🔍 INTERNSHIP DETAILS '.padEnd(50, '-'));
console.log('│ GET    /api/internships/:id             - Get internship details (PROTECTED)');
    console.log('\n' + '='.repeat(70));
    console.log('✅ Ready! All endpoints are now active.\n');

    // في قسم console.log أضف:
console.log('\n' + '💾 SAVED INTERNSHIPS '.padEnd(50, '-'));
console.log('│ GET    /api/student/saved-internships              - Get all saved (PROTECTED)');
console.log('│ POST   /api/student/saved-internships/:id          - Save internship (PROTECTED)');
console.log('│ DELETE /api/student/saved-internships/:id          - Remove saved (PROTECTED)');
console.log('│ DELETE /api/student/saved-internships              - Remove all (PROTECTED)');
console.log('│ GET    /api/student/saved-internships/check/:id    - Check if saved (PROTECTED)');
console.log('│ PUT    /api/student/saved-internships/:id/notes    - Add notes (PROTECTED)');
console.log('│ GET    /api/student/saved-internships/recommendations - Get recommendations (PROTECTED)');

});

// 📤 EXPORTS
module.exports = { generateConventionDeStagePDF };

/*
app.get('/api/company/agreements/:agreementId', protect, async (req, res) => {
  try {
    const companyId = req.user.id;
    const agreementId = req.params.agreementId;
    
    console.log(`🔍 Company ${companyId} fetching agreement ${agreementId}`);
    
    if (req.user.user_type !== 'company') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Company only.' 
      });
    }

    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.generated_at,
        a.sent_at,
        a.signed_at,
        a.archived_at,
        a.pdf_url,
        a.university_name,
        a.created_at,
        a.student_signed,
        a.company_signed,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.first_name,
        s.last_name,
        s.university,
        s.email as student_email,
        i.title as internship_title,
        i.description,
        i.duration,
        i.stipend,
        i.location,
        i.type as internship_type,
        c.company_name,
        c.id as company_id
      FROM agreements a
      JOIN internships i ON a.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      JOIN students s ON a.student_id = s.user_id
      WHERE a.id = ? AND i.company_id = ?
    `, [agreementId, companyId]);
    
    if (agreements.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Agreement not found' 
      });
    }
    
    res.json({
      success: true,
      agreement: agreements[0]
    });
    
  } catch (error) {
    console.error('🔥 Error fetching agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching agreement',
      error: error.message 
    });
  }
});*/
