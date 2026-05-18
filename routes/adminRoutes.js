const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { protect } = require('../middleware/authMiddleware');

const { generateConventionDeStagePDF } = require('../server');

const isAdmin = async (req, res, next) => {
  if (req.user.user_type !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied. Admin only.' 
    });
  }
  next();
};

const nodemailer = require('nodemailer');



const sendAgreementEmail = async (agreementData) => {
  try {
    const { student_email, company_email, student_name, company_name, internship_title, pdf_url } = agreementData;
    
    console.log('📧 Sending automatic email to:', { student: student_email, company: company_email });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const pdfLink = `http://stag-io-backend.onrender.com${pdf_url}`;

    const mailOptions = {
      from: `"STAG Platform" <${process.env.EMAIL_USER}>`,
      to: `${student_email}, ${company_email}`,
      subject: `📄 Internship Agreement Generated - ${internship_title}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5;">STAG Platform</h1>
            <p style="color: #666;">Internship Agreement</p>
          </div>
          
          <div style="background: #f9f9f9; padding: 25px; border-radius: 8px;">
            <p>Dear <strong>${student_name}</strong> and <strong>${company_name}</strong>,</p>
            
            <p>Your internship agreement for <strong>"${internship_title}"</strong> has been generated successfully.</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4F46E5;">
              <h3 style="color: #4F46E5; margin-top: 0;">📋 Agreement Details</h3>
              <p><strong>Student:</strong> ${student_name}</p>
              <p><strong>Company:</strong> ${company_name}</p>
              <p><strong>Position:</strong> ${internship_title}</p>
              <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${pdfLink}" 
                 style="background: #4F46E5; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                📥 Download Agreement PDF
              </a>
            </div>
            
            <p>Best regards,<br>STAG Platform Admin</p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Automatic email sent:', info.messageId);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error('❌ Error sending automatic email:', error.message);
    return { success: false, error: error.message };
  }
};



const notifyAgreementGenerated = async (agreementId, studentId, companyId, internshipTitle, studentName, companyName) => {
  try {
    const connection = await db.getConnection();
    
    const message = `Internship agreement for ${studentName} at ${companyName} (${internshipTitle}) has been generated.`;
    
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, student_id, company_id, agreement_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'agreement_generated',        
        '📄 Agreement Generated',      
        message,                       
        studentId,                      
        companyId,                      
        agreementId                     
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



router.get('/api/admin/companies', protect, isAdmin, async (req, res) => {
  try {
    const [companies] = await db.execute(`
      SELECT 
        u.id,
        u.email,
        u.is_verified,
        u.is_suspended,
        u.created_at,
        c.company_name,
        c.contact_person,
        c.phone,
        c.website,
        c.trade_register,
        c.activity_sector,
        c.company_size,
        c.wilaya,
        c.address,
        c.description,
        c.logo_url,
        c.cover_image_url,
        (SELECT COUNT(*) FROM internships WHERE company_id = u.id) as internships_count,
        CASE 
          WHEN u.is_verified = 0 THEN 'pending'
          ELSE 'verified'
        END as verification_status
      FROM users u
      JOIN companies c ON u.id = c.user_id
      WHERE u.user_type = 'company'
      ORDER BY u.created_at DESC
    `);

    res.json({
      success: true,
      companies
    });

  } catch (error) {
    console.error('🔥 Error fetching companies:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching companies' 
    });
  }
});


router.put('/api/admin/companies/:id/verify', protect, isAdmin, async (req, res) => {
  try {
    const companyId = req.params.id;
    
    const [result] = await db.execute(
      'UPDATE users SET is_verified = 1, is_suspended = 0 WHERE id = ? AND user_type = "company"',
      [companyId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Company not found' 
      });
    }
    
    const [updatedCompany] = await db.execute(
      `SELECT u.id, u.email, u.is_verified, u.is_suspended,
              c.company_name, c.wilaya,
              (SELECT COUNT(*) FROM internships WHERE company_id = u.id) as internships_count
       FROM users u
       JOIN companies c ON u.id = c.user_id
       WHERE u.id = ?`,
      [companyId]
    );
    
    console.log(`✅ Company ${companyId} verified and activated successfully`);
    
    res.json({ 
      success: true, 
      message: 'Company verified and activated successfully',
      company: updatedCompany[0]
    });
    
  } catch (error) {
    console.error('🔥 Error verifying company:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error verifying company' 
    });
  }
});


router.put('/api/admin/companies/:id/suspend', protect, isAdmin, async (req, res) => {
  try {
    const companyId = req.params.id;
    
    const [result] = await db.execute(
      'UPDATE users SET is_suspended = 1 WHERE id = ? AND user_type = "company"',
      [companyId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Company not found' 
      });
    }
    
    console.log(`✅ Company ${companyId} suspended successfully`);
    
    res.json({ 
      success: true, 
      message: 'Company suspended successfully' 
    });
    
  } catch (error) {
    console.error('🔥 Error suspending company:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error suspending company' 
    });
  }
});

router.put('/api/admin/companies/:id/unsuspend', protect, isAdmin, async (req, res) => {
  try {
    const companyId = req.params.id;
    
    const [result] = await db.execute(
      'UPDATE users SET is_suspended = 0 WHERE id = ? AND user_type = "company"',
      [companyId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Company not found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Company activated successfully' 
    });
    
  } catch (error) {
    console.error('🔥 Error activating company:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error activating company' 
    });
  }
});


router.delete('/api/admin/companies/:id', protect, isAdmin, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const companyId = req.params.id;
    await connection.execute('DELETE FROM internships WHERE company_id = ?', [companyId]);
    await connection.execute('DELETE FROM companies WHERE user_id = ?', [companyId]);
    await connection.execute('DELETE FROM users WHERE id = ? AND user_type = "company"', [companyId]);
    await connection.commit();
    res.json({ success: true, message: 'Company deleted successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('🔥 Error deleting company:', error);
    res.status(500).json({ success: false, message: 'Error deleting company' });
  } finally {
    connection.release();
  }
});


router.get('/api/admin/students', protect, isAdmin, async (req, res) => {
  try {
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
        s.github_link,
        s.linkedin_link,
        s.profile_image_url,
        s.social_security,        
        s.academic_supervisor, 
        (SELECT COUNT(*) FROM student_internships WHERE student_id = u.id) as applications_count,
        (SELECT COUNT(*) FROM student_internships WHERE student_id = u.id AND status = 'accepted') as accepted_count
      FROM users u
      JOIN students s ON u.id = s.user_id
      WHERE u.user_type = 'student'
      ORDER BY u.created_at DESC
    `);

    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total,
        (SELECT COUNT(DISTINCT student_id) FROM student_internships) as total_applications,
        (SELECT COUNT(DISTINCT university) FROM students) as total_universities
      FROM students
    `);

    res.json({ 
      success: true, 
      students, 
      stats: {
        total: stats[0].total,
        totalApplications: stats[0].total_applications,
        totalUniversities: stats[0].total_universities,
        suspended: 0  
      } 
    });

  } catch (error) {
    console.error('🔥 Error fetching students:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching students',
      error: error.message 
    });
  }
});



router.put('/api/admin/students/:id/suspend', protect, isAdmin, async (req, res) => {
  try {
    const studentId = req.params.id;
    
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


router.put('/api/admin/students/:id/unsuspend', protect, isAdmin, async (req, res) => {
  try {
    const studentId = req.params.id;
    
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

router.get('/api/admin/stats', protect, isAdmin, async (req, res) => {
  try {
    const [companies] = await db.execute("SELECT COUNT(*) as count FROM users WHERE user_type = 'company'");
    const [pendingCompanies] = await db.execute("SELECT COUNT(*) as count FROM users WHERE user_type = 'company' AND is_verified = 0");
    const [students] = await db.execute("SELECT COUNT(*) as count FROM users WHERE user_type = 'student'");
    const [studentsWithApps] = await db.execute("SELECT COUNT(DISTINCT student_id) as count FROM student_internships");
    const [internships] = await db.execute("SELECT COUNT(*) as count FROM internships");
    const [activeInternships] = await db.execute(
  "SELECT COUNT(*) as count FROM internships WHERE status = 'active'"
);
    
    // ✅ التصحيح الصحيح - PENDING ACCEPT من جدول agreements
    const [pendingAccept] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM agreements 
      WHERE status = 'pending' 
         OR student_signed = 0 
         OR company_signed = 0
    `);

    const [agreements] = await db.execute("SELECT COUNT(*) as count FROM agreements");
    const [pendingAgreements] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM agreements 
      WHERE status = 'pending' 
         OR student_signed = 0 
         OR company_signed = 0
    `);

    const [placed] = await db.execute(`
      SELECT COUNT(DISTINCT a.student_id) as count
      FROM agreements a
      WHERE a.status = 'completed' 
         OR (a.student_signed = 1 AND a.company_signed = 1)
    `);

    const [inProgress] = await db.execute(`
      SELECT COUNT(DISTINCT student_id) as count
      FROM student_internships
      WHERE status IN ('pending', 'reviewed', 'interview')
    `);

    const totalStudents = students[0].count;
    const placedStudents = placed[0].count;
    const unplaced = totalStudents - placedStudents;

    const result = {
      totalCompanies: companies[0].count,
      pendingCompanies: pendingCompanies[0].count,
      totalStudents: totalStudents,
      totalApplications: studentsWithApps[0].count,
      totalInternships: internships[0].count,
      activeInternships: activeInternships[0].count,
      pendingAcceptances: pendingAccept[0].count,  // ✅ الآن = 6
      agreements: agreements[0].count,
      pendingSignatures: pendingAgreements[0].count,
      placed: placedStudents,
      inProgress: inProgress[0].count || 0,
      unplaced: unplaced > 0 ? unplaced : 0
    };

    res.json({ success: true, stats: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching stats' });
  }
});

/*
router.get('/api/admin/stats', protect, isAdmin, async (req, res) => {
  try {
   
    const [companies] = await db.execute(
      "SELECT COUNT(*) as count FROM users WHERE user_type = 'company'"
    );

    const [pendingCompanies] = await db.execute(
      "SELECT COUNT(*) as count FROM users WHERE user_type = 'company' AND is_verified = 0"
    );

    const [students] = await db.execute(
      "SELECT COUNT(*) as count FROM users WHERE user_type = 'student'"
    );

    const [studentsWithApps] = await db.execute(
      "SELECT COUNT(DISTINCT student_id) as count FROM student_internships"
    );

    const [internships] = await db.execute(
      "SELECT COUNT(*) as count FROM internships"
    );

    /*const [notifications] = await db.execute(
      "SELECT COUNT(*) as count FROM admin_notifications WHERE is_read = 0"
    );
    const [pendingAccept] = await db.execute(`
  SELECT COUNT(*) as count 
  FROM agreements 
  WHERE status = 'pending' 
     OR (student_signed = 0 OR company_signed = 0)
`);

    const [agreements] = await db.execute(
      "SELECT COUNT(*) as count FROM agreements"
    );

    const [pendingAgreements] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM agreements 
      WHERE status = 'pending' 
         OR student_signed = 0 
         OR company_signed = 0
    `);

    const [placed] = await db.execute(`
      SELECT COUNT(DISTINCT a.student_id) as count
      FROM agreements a
      WHERE a.status = 'completed' 
         OR (a.student_signed = 1 AND a.company_signed = 1)
    `);

    const [inProgress] = await db.execute(`
      SELECT COUNT(DISTINCT student_id) as count
      FROM student_internships
      WHERE status IN ('pending', 'reviewed', 'interview')
    `);

    const totalStudents = students[0].count;
    const placedStudents = placed[0].count;
    const unplaced = totalStudents - placedStudents;

    const result = {
      totalCompanies: companies[0].count,
      pendingCompanies: pendingCompanies[0].count,
      totalStudents: totalStudents,
      totalApplications: studentsWithApps[0].count,
      totalInternships: internships[0].count,
      ///pendingAcceptances: notifications[0].count,
      pendingAcceptances: pendingAccept[0].count,
      agreements: agreements[0].count,
      pendingSignatures: pendingAgreements[0].count,
      placed: placedStudents,
      inProgress: inProgress[0].count || 0,
      unplaced: unplaced > 0 ? unplaced : 0
    };

    console.log('📊 Final stats being sent:', result);

    res.json({
      success: true,
      stats: result
    });

  } catch (error) {
    console.error('🔥 Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Error fetching stats' });
  }
});
*/


router.get('/api/admin/applications/pending', protect, isAdmin, async (req, res) => {
  try {
    const [applications] = await db.execute(`
      SELECT 
        si.id,
        si.student_id,
        si.internship_id,
        si.status,
        si.is_validated,
        si.applied_at,
        si.updated_at,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.university,
        s.specialization,
        i.title as internship_title,
        i.company_id,
        c.company_name,
        c.wilaya as company_location
      FROM student_internships si
      JOIN students s ON si.student_id = s.user_id
      JOIN internships i ON si.internship_id = i.id
      JOIN companies c ON i.company_id = c.user_id
      WHERE si.status = 'accepted' AND (si.is_validated = 0 OR si.is_validated IS NULL)
      ORDER BY si.updated_at DESC
    `);
    
    res.json({ success: true, applications });
    
  } catch (error) {
    console.error('🔥 Error fetching pending applications:', error);
    res.status(500).json({ success: false, message: 'Error fetching pending applications' });
  }
});


router.get('/api/admin/applications/:applicationId/details', protect, isAdmin, async (req, res) => {
  try {
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
    `, [req.params.applicationId]);
    
    if (applications.length === 0) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    
    const application = applications[0];
    
    if (application.skills && typeof application.skills === 'string') {
      try {
        application.skills = JSON.parse(application.skills);
      } catch (e) {
        application.skills = [];
      }
    }
    
    if (application.required_skills && typeof application.required_skills === 'string') {
      try {
        application.required_skills = JSON.parse(application.required_skills);
      } catch (e) {
        application.required_skills = [];
      }
    }
    
    res.json({ success: true, application });
    
  } catch (error) {
    console.error('🔥 Error fetching application details:', error);
    res.status(500).json({ success: false, message: 'Error fetching application details' });
  }
});


// ✅ مصادقة قبول الطالب من قبل الأدمن (Validate Internship)
router.put('/api/admin/applications/:applicationId/validate', protect, isAdmin, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const applicationId = req.params.applicationId;
    
    console.log(`✅ Validating application ID: ${applicationId}`);
    
    // 1. التحقق من وجود الطلب
    const [applications] = await connection.execute(`
      SELECT 
        si.*, 
        i.title as internship_title,
        i.company_id,
        c.company_name,
        c.user_id as company_user_id,
        s.user_id as student_id,
        s.first_name,
        s.last_name,
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
        message: 'Application not found' 
      });
    }
    
    const application = applications[0];
    
    // 2. التحقق من أن الطلب مقبول ولم يتم المصادقة عليه بعد
    if (application.status !== 'accepted') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Only accepted applications can be validated' 
      });
    }
    
    if (application.is_validated === 1) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Application already validated' 
      });
    }
    
    // 3. تحديث حالة الطلب إلى validated
    await connection.execute(
      `UPDATE student_internships 
       SET is_validated = 1, 
           updated_at = NOW() 
       WHERE id = ?`,
      [applicationId]
    );
    
    // 4. إشعار للطالب
    await connection.execute(
      `INSERT INTO notifications 
       (user_id, type, title, message, application_id, created_at) 
       VALUES (?, 'validation', ?, ?, ?, NOW())`,
      [
        application.student_id,
        '✅ Internship Validated',
        `Your internship "${application.internship_title}" at ${application.company_name} has been validated by the administration. The agreement has been generated.`,
        applicationId
      ]
    );
    
    // 5. إشعار للشركة
    await connection.execute(
      `INSERT INTO company_notifications 
       (company_id, type, title, message, application_id, created_at) 
       VALUES (?, 'validation', ?, ?, ?, NOW())`,
      [
        application.company_user_id,
        '✅ Internship Validated',
        `The internship "${application.internship_title}" for ${application.first_name} ${application.last_name} has been validated.`,
        applicationId
      ]
    );
    
    // 6. تحديث إشعار الأدمن
    await connection.execute(
      `UPDATE admin_notifications 
       SET is_read = 1, 
           data = JSON_SET(IFNULL(data, '{}'), '$.validated', TRUE)
       WHERE application_id = ? AND type = 'company_accept'`,
      [applicationId]
    );
    
    // 7. إنشاء إشعار جديد للأدمن (تأكيد)
    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, student_id, company_id, application_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'validation_complete',
        '✅ Validation Complete',
        `Internship "${application.internship_title}" for ${application.first_name} ${application.last_name} has been validated.`,
        application.student_id,
        application.company_user_id,
        applicationId
      ]
    );
    
    await connection.commit();
    connection.release();
    
    console.log(`✅ Application ${applicationId} validated successfully`);
    
    res.json({ 
      success: true, 
      message: 'Internship validated successfully' 
    });
    
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('🔥 Error validating internship:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error validating internship',
      error: error.message 
    });
  }
});

router.get('/api/admin/agreements', protect, isAdmin, async (req, res) => {
  try {
    console.log('📋 Fetching agreements...');
    
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
        a.created_at,
        a.student_signed,
        a.company_signed,
        a.university_signed,
        a.company_signed_at,
        a.university_signed_at,
        a.completed_at,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        i.title as internship_title,
        c.company_name
      FROM agreements a
      LEFT JOIN students s ON a.student_id = s.user_id
      LEFT JOIN internships i ON a.internship_id = i.id
      LEFT JOIN companies c ON i.company_id = c.user_id
      ORDER BY a.created_at DESC
    `);

    console.log(`✅ Found ${agreements.length} agreements`);
    console.log('📊 First agreement:', agreements[0]); 
    
    res.json({ success: true, agreements });

  } catch (error) {
    console.error('🔥 Error fetching agreements:', error);
    res.json({ success: true, agreements: [] });
  }
});

router.post('/api/admin/agreements/generate-from-notification', protect, isAdmin, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const { notificationId, studentName, companyName, internshipTitle } = req.body;
    console.log('📄 Generating agreement from notification:', { notificationId, studentName, companyName, internshipTitle });

    const [student] = await connection.execute(
      `SELECT s.user_id, s.first_name, s.last_name, s.university, u.email as student_email 
       FROM students s 
       JOIN users u ON s.user_id = u.id 
       WHERE CONCAT(s.first_name, ' ', s.last_name) LIKE ?`,
      [`%${studentName}%`]
    );

    const [company] = await connection.execute(
      `SELECT c.user_id, c.company_name, u.email as company_email 
       FROM companies c 
       JOIN users u ON c.user_id = u.id 
       WHERE c.company_name LIKE ?`,
      [`%${companyName}%`]
    );

let internshipId = null;
if (company.length > 0) {
  console.log('🔍 Searching for internship:', { 
    title: internshipTitle, 
    company_id: company[0].user_id 
  });
  
  const [internship] = await connection.execute(
    `SELECT id FROM internships WHERE title LIKE ? AND company_id = ?`,
    [`%${internshipTitle}%`, company[0].user_id]
  );
  
  if (internship.length > 0) {
    internshipId = internship[0].id;
    console.log('✅ Found internship by title:', internshipId);
  } else {
    console.log('⚠️ No internship found with title:', internshipTitle);
    
    const [firstInternship] = await connection.execute(
      `SELECT id FROM internships WHERE company_id = ? LIMIT 1`,
      [company[0].user_id]
    );
    
    if (firstInternship.length > 0) {
      internshipId = firstInternship[0].id;
      console.log('✅ Using first available internship ID:', internshipId);
    } else {
    
      console.error('❌ Company has no internships!');
      throw new Error('Company has no internships');
    }
  }
}

if (student.length === 0) {
  await connection.rollback();
  connection.release();
  return res.status(404).json({
    success: false,
    message: `Student "${studentName}" not found in database`
  });
}

if (company.length === 0) {
  await connection.rollback();
  connection.release();
  return res.status(404).json({
    success: false,
    message: `Company "${companyName}" not found in database`
  });
}

const studentId = student[0].user_id;
const studentEmail = student[0].student_email;
const companyEmail = company[0].company_email;
const companyId = company[0].user_id;
const studentFullName = `${student[0].first_name} ${student[0].last_name}`;
const companyFullName = company[0].company_name;
const universityName = student[0].university || 'University not specified';


const fileName = `agreement_${studentId}_${companyId}_${Date.now()}.pdf`;
const pdfUrl = `/uploads/agreements/${fileName}`;

console.log('✅ Found in database:', {
  studentId,
  studentFullName,
  companyId,
  companyFullName,
  universityName
});

    const [result] = await connection.execute(
      `INSERT INTO agreements (student_id, internship_id, status, generated_at, pdf_url, created_at, university_name) 
       VALUES (?, ?, 'pending', NOW(), ?, NOW(), ?)`,
      [studentId, internshipId, pdfUrl, universityName]
    );

    await notifyAgreementGenerated(
  result.insertId,
  studentId,
  company[0]?.user_id,
  internshipTitle,
  studentFullName,
  companyFullName
);

    if (notificationId) {
      await connection.execute('UPDATE admin_notifications SET is_read = 1 WHERE id = ?', [notificationId]);
    }

    await connection.commit();
    console.log('✅ Agreement created with ID:', result.insertId);

if (result && result.insertId) {

  await generateAndSavePDF(
    studentFullName,
    companyFullName,
    internshipTitle,
    universityName,
    result.insertId
  );
}

    try {
      const emailResult = await sendAgreementEmail({
        student_email: studentEmail,
        company_email: companyEmail,
        student_name: studentFullName,
        company_name: companyFullName,
        internship_title: internshipTitle,
        pdf_url: pdfUrl
      });
      
      if (emailResult.success) {
        console.log('✅ Automatic email sent successfully');
        await connection.execute('UPDATE agreements SET sent_at = NOW() WHERE id = ?', [result.insertId]);
      } else {
        console.warn('⚠️ Email sending failed but agreement was created');
      }
    } catch (emailError) {
      console.warn('⚠️ Email sending error (agreement still created):', emailError.message);
    }

    res.json({ 
      success: true, 
      message: 'Agreement generated successfully and email sent',
      agreement_id: result.insertId 
    });

  } catch (error) {
    await connection.rollback();
    console.error('🔥 Error generating agreement:', error);
    res.status(500).json({ success: false, message: 'Error generating agreement' });
  } finally {
    connection.release();
  }
});




router.post('/api/admin/agreements/generate-pdf', protect, isAdmin, async (req, res) => {
  try {
    const data = req.body;
    
    console.log('📄 Generating ENGLISH Internship Agreement PDF for admin');
    console.log('social_security:', data.socialSecurity);
    console.log('academic_supervisor:', data.supervisor);
    
    await generateEnglishAgreementPDF(data, res);
    
  } catch (error) {
    console.error('🔥 Error generating agreement:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        message: 'Error generating agreement: ' + error.message 
      });
    }
  }
});

router.post('/api/admin/agreements/:id/send', protect, isAdmin, async (req, res) => {
  try {
    const agreementId = req.params.id;
    
    console.log(`📧 Sending agreement ID: ${agreementId}`);

    const [agreements] = await db.execute(`
      SELECT 
        a.id,
        a.student_id,
        a.internship_id,
        a.status,
        a.generated_at,
        a.pdf_url,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.first_name,
        s.last_name,
        u.email as student_email,
        i.title as internship_title,
        i.description,
        i.duration,
        i.stipend,
        c.company_name,
        c.phone as company_phone,
        c.wilaya as company_location,
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
    
    console.log('📨 Sending email for:', {
      to: [agreement.student_email, agreement.company_email],
      student: agreement.student_name,
      company: agreement.company_name,
      internship: agreement.internship_title
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
      }
    });

    const pdfLink = `http://stag-io-backend.onrender.com${agreement.pdf_url}`;

    const mailOptions = {
      from: `"STAG Platform" <${process.env.EMAIL_USER || 'your-email@gmail.com'}>`,
      to: `${agreement.student_email}, ${agreement.company_email}`,
      subject: `📄 Internship Agreement - ${agreement.internship_title}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <!-- Header -->
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; margin-bottom: 5px;">STAG Platform</h1>
            <p style="color: #666; font-size: 16px;">Internship Agreement</p>
          </div>
          
          <!-- Content -->
          <div style="background: #f9f9f9; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
            <p style="font-size: 16px; color: #333;">Dear <strong>${agreement.student_name}</strong> and <strong>${agreement.company_name}</strong>,</p>
            
            <p style="font-size: 16px; color: #333; line-height: 1.6;">
              The internship agreement for <strong>"${agreement.internship_title}"</strong> has been generated and is ready for your review.
            </p>
            
            <!-- Agreement Details -->
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4F46E5;">
              <h3 style="color: #4F46E5; margin-top: 0; margin-bottom: 15px;">📋 Agreement Details</h3>
              
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #666; width: 40%;"><strong>Student:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${agreement.student_name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;"><strong>Company:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${agreement.company_name}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;"><strong>Position:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${agreement.internship_title}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;"><strong>Duration:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${agreement.duration || '3'} months</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;"><strong>Stipend:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${agreement.stipend || 'Negotiable'} DZD</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;"><strong>Generated:</strong></td>
                  <td style="padding: 8px 0; color: #333;">${new Date(agreement.generated_at).toLocaleDateString()}</td>
                </tr>
              </table>
            </div>
            
            <!-- Download Button -->
            <div style="text-align: center; margin: 30px 0;">
              <a href="${pdfLink}" 
                 style="background: #4F46E5; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                📥 Download Agreement (PDF)
              </a>
            </div>
            
            <!-- Instructions -->
            <div style="background: #e8f4fd; padding: 15px; border-radius: 8px; margin-top: 20px;">
              <p style="margin: 0; color: #0369a1; font-size: 14px;">
                <strong>📌 Next Steps:</strong>
              </p>
              <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #0369a1; font-size: 14px;">
                <li>Download the agreement PDF</li>
                <li>Review the terms and conditions</li>
                <li>Both parties need to sign the agreement</li>
                <li>Upload the signed copy to the platform</li>
              </ul>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #999; font-size: 12px;">
            <p>This is an automated message from STAG Platform. Please do not reply to this email.</p>
            <p>© ${new Date().getFullYear()} STAG Platform. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent:', info.messageId);

    await db.execute('UPDATE agreements SET sent_at = NOW() WHERE id = ?', [agreementId]);

    res.json({ 
      success: true, 
      message: '✅ Agreement sent successfully to student and company',
      emailId: info.messageId
    });

  } catch (error) {
    console.error('🔥 Error sending agreement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error sending agreement: ' + error.message 
    });
  }
});
/*
router.put('/api/admin/agreements/:id/archive', protect, isAdmin, async (req, res) => {
  try {
    const agreementId = req.params.id;
    await db.execute('UPDATE agreements SET status = "archived", archived_at = NOW() WHERE id = ?', [agreementId]);
    res.json({ success: true, message: 'Agreement archived successfully' });
  } catch (error) {
    console.error('🔥 Error archiving agreement:', error);
    res.status(500).json({ success: false, message: 'Error archiving agreement' });
  }
});
*/



const generateEnglishAgreementPDF = (data, res) => {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const path = require('path');  
      const fs = require('fs');
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      
      doc.pipe(res);

      const logoPath = path.join(__dirname, '..', 'uploads', 'logo-univ.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, 30, { width: 60, height: 60 });
      }
      
      let yPos = 80;
      
      doc.fontSize(20).font('Helvetica-Bold').text('INTERNSHIP AGREEMENT', 0, yPos, { align: 'center' });
      yPos += 60;
      
      const boxWidth = 230;
      const boxHeight = 120;
      const leftBoxX = 50;
      const rightBoxX = 300;
      let boxesY = yPos;
      
      doc.fontSize(11).font('Helvetica-Bold').text('BETWEEN', leftBoxX + 10, boxesY - 15);
      
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
      
      doc.fontSize(8).font('Helvetica').text(
        'Prepared in 02 original copies: 1 copy for the university and 01 copy for the company', 
        50, yPos, { align: 'center' }
      );
      yPos += 18;
      
      const currentDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
      doc.text(`Done at Constantine on: ${currentDate}`, 50, yPos);
      yPos += 25;
      
      const sigWidth = 155;
      const sigHeight = 55;
      
      doc.rect(50, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the university", 58, yPos + 6);
      if (data.universitySignature) {
        try {
          const signaturePath = path.join(__dirname, '..', data.universitySignature);
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
          const signaturePath = path.join(__dirname, '..', data.companySignature);
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
          const signaturePath = path.join(__dirname, '..', data.studentSignature);
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


const generateEnglishAgreementPDFBuffer = (data) => {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const path = require('path');
      const fs = require('fs');
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      
      const logoPath = path.join(__dirname, '..', 'uploads', 'logo-univ.png');
      if (fs.existsSync(logoPath)) {
       // doc.image(logoPath, 40, 30, { width: 60, height: 60 });
       doc.image(logoPath, 40, 35, { width: 100 });
      }
      
      let yPos = 120;
      
      doc.fontSize(20).font('Helvetica-Bold').text('INTERNSHIP AGREEMENT', 0, yPos, { align: 'center' });
      yPos += 60;
      
      const boxWidth = 230;
      const boxHeight = 120;
      const leftBoxX = 50;
      const rightBoxX = 300;
      let boxesY = yPos;
      
      doc.fontSize(11).font('Helvetica-Bold').text('BETWEEN', leftBoxX + 10, boxesY - 15);
      
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
      
      doc.fontSize(8).font('Helvetica').text(
        'Prepared in 02 original copies: 1 copy for the university and 01 copy for the company', 
        50, yPos, { align: 'center' }
      );
      yPos += 18;
      
      const currentDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
      doc.text(`Done at Constantine on: ${currentDate}`, 50, yPos);
      yPos += 25;
      
      const sigWidth = 155;
      const sigHeight = 55;
      
      doc.rect(50, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the university", 58, yPos + 6);
      doc.fontSize(8).font('Helvetica').text('___________________', 58, yPos + 22);
      
      doc.rect(225, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the company", 233, yPos + 6);
      doc.fontSize(8).font('Helvetica').text('___________________', 233, yPos + 22);
      
      doc.rect(400, yPos, sigWidth, sigHeight).stroke();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#1F2937').text("For the student", 408, yPos + 6);
      doc.fontSize(8).font('Helvetica').text('___________________', 408, yPos + 22);
      
      doc.end();
      
    } catch (error) {
      reject(error);
    }
  });
};




router.put('/api/admin/applications/:id/reject', protect, isAdmin, async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const applicationId = req.params.id;
    const { reason } = req.body;
    
    console.log(`❌ Rejecting application ID: ${applicationId}, Reason: ${reason}`);

    if (!reason) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ 
        success: false, 
        message: 'Rejection reason is required' 
      });
    }

    const [applications] = await connection.execute(`
      SELECT 
        si.*,
        i.title as internship_title,
        i.company_id,
        c.company_name,
        s.first_name,
        s.last_name,
        u.id as student_user_id
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
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const application = applications[0];

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

    await connection.execute(
      `INSERT INTO notifications 
       (user_id, type, title, message, application_id, created_at) 
       VALUES (?, 'rejection', ?, ?, ?, NOW())`,
      [
        application.student_user_id,
        '❌ Internship Rejected',
        `Your internship "${application.internship_title}" at ${application.company_name} has been rejected. Reason: ${reason}`,
        applicationId
      ]
    );

    await connection.execute(
      `INSERT INTO company_notifications 
       (company_id, type, title, message, application_id, created_at) 
       VALUES (?, 'rejection', ?, ?, ?, NOW())`,
      [
        application.company_id,
        '❌ Internship Rejected',
        `The internship "${application.internship_title}" for ${application.first_name} ${application.last_name} has been rejected. Reason: ${reason}`,
        applicationId
      ]
    );

    await connection.execute(
      `INSERT INTO admin_notifications 
       (type, title, message, student_id, company_id, application_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        'rejection_complete',
        '❌ Rejection Processed',
        `Internship rejected for ${application.first_name} ${application.last_name}. Reason: ${reason}`,
        application.student_user_id,
        application.company_id,
        applicationId
      ]
    );

    await connection.commit();

    res.json({ 
      success: true, 
      message: 'Internship rejected successfully' 
    });

  } catch (error) {
    await connection.rollback();
    console.error('🔥 Error rejecting internship:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error rejecting internship: ' + error.message 
    });
  } finally {
    connection.release();
  }
});




router.get('/api/admin/validation-stats', protect, isAdmin, async (req, res) => {
  try {
    const [stats] = await db.execute(`
      SELECT 
        (SELECT COUNT(*) FROM student_internships WHERE status = 'accepted' AND (is_validated = 0 OR is_validated IS NULL)) as pending_validation,
        (SELECT COUNT(*) FROM student_internships WHERE status = 'accepted' AND is_validated = 1) as validated,
        (SELECT COUNT(*) FROM student_internships WHERE status = 'rejected') as rejected,
        (SELECT COUNT(*) FROM student_internships WHERE status = 'accepted') as total_accepted
    `);
    
    res.json({ success: true, stats: stats[0] });
    
  } catch (error) {
    console.error('🔥 Error fetching validation stats:', error);
    res.status(500).json({ success: false, message: 'Error fetching validation stats' });
  }
});


const generateAndSavePDF = async (studentName, companyName, internshipTitle, university, agreementId) => {
  try {
    console.log('📄 Generating and saving PDF for:', { studentName, companyName, internshipTitle, university, agreementId });
    
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4'
    });
    const fs = require('fs').promises;
    const path = require('path');
    
   
    const uploadDir = path.join(__dirname, '..', 'uploads', 'agreements');
    console.log('📁 Target directory:', uploadDir);
    
    
    try {
      await fs.access(uploadDir);
    } catch {
      await fs.mkdir(uploadDir, { recursive: true });
      console.log('✅ Created directory');
    }
    
    
    const safeStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `agreement_${safeStudentName}_${agreementId}_${Date.now()}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    const pdfUrl = `/uploads/agreements/${fileName}`;
    
    
    const chunks = [];
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    
    doc.rect(50, 45, 500, 15).fill('#4F46E5');
    
    doc.fontSize(24)
       .font('Helvetica-Bold')
       .fillColor('#1F2937')
       .text('INTERNSHIP AGREEMENT', 50, 80, { align: 'center' });
    
    doc.strokeColor('#4F46E5')
       .lineWidth(2)
       .moveTo(50, 120)
       .lineTo(550, 120)
       .stroke();
    
    doc.fontSize(12)
       .font('Helvetica')
       .fillColor('#4B5563')
       .text(`Date: ${new Date().toLocaleDateString('en-US', { 
         year: 'numeric', 
         month: 'long', 
         day: 'numeric' 
       })}`, 50, 140, { align: 'right' });
    
    doc.moveDown(2);
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor('#1F2937')
       .text('This Agreement is made between:', 50, 180);
    
    doc.roundedRect(50, 210, 240, 80, 10).fillAndStroke('#EEF2FF', '#4F46E5');
    doc.fillColor('#1F2937')
       .font('Helvetica-Bold')
       .fontSize(12)
       .text('THE COMPANY', 70, 225);
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor('#374151')
       .text(`Name: ${companyName}`, 70, 245)
       .text('(Hereinafter referred to as "The Company")', 70, 265);
    
    doc.roundedRect(310, 210, 240, 80, 10).fillAndStroke('#EEF2FF', '#4F46E5');
    doc.fillColor('#1F2937')
       .font('Helvetica-Bold')
       .fontSize(12)
       .text('THE STUDENT', 330, 225);
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor('#374151')
       .text(`Name: ${studentName}`, 330, 245)
       .text(`University: ${university || 'University not specified'}`, 330, 265);
    
    doc.roundedRect(50, 310, 500, 80, 10).fillAndStroke('#F3F4F6', '#9CA3AF');
    doc.fillColor('#1F2937')
       .font('Helvetica-Bold')
       .fontSize(12)
       .text('INTERNSHIP POSITION', 70, 330);
    doc.font('Helvetica')
       .fontSize(14)
       .fillColor('#4F46E5')
       .text(internshipTitle, 70, 350, { align: 'center', width: 460 });
    
    doc.fillColor('#1F2937')
       .font('Helvetica-Bold')
       .fontSize(14)
       .text('TERMS AND CONDITIONS', 50, 420);
    
    doc.roundedRect(50, 445, 500, 140, 8).stroke('#E5E7EB');
    
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor('#374151');
    
    const terms = [
      '1. The student agrees to complete the internship period as specified in this agreement.',
      '2. The company agrees to provide necessary training, supervision, and resources.',
      '3. The university agrees to oversee the internship progress and provide academic supervision.',
      '4. Both parties agree to maintain confidentiality of any proprietary information.',
      '5. The internship will commence on the start date and continue for the agreed duration.',
      '6. Either party may terminate this agreement with 7 days written notice.',
      '7. The student agrees to abide by the company\'s policies and regulations.'
    ];
    
    let yPos = 460;
    terms.forEach(term => {
      doc.text(term, 70, yPos, { width: 460 });
      yPos += 18;
    });
    
  
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .fillColor('#1F2937')
       .text('SIGNATURES', 50, 610);
    
    
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor('#374151')
       .text('Company Representative:', 50, 640);
    doc.font('Helvetica-Bold')
       .text('_________________________', 50, 655);
    doc.font('Helvetica')
       .text('Name: ___________________', 50, 675);
    
    
    doc.font('Helvetica')
       .text('Student:', 210, 640);
    doc.font('Helvetica-Bold')
       .text('_________________________', 210, 655);
    doc.font('Helvetica')
       .text(`Name: ${studentName}`, 210, 675);
    
    
    doc.font('Helvetica')
       .text('University Supervisor:', 370, 640);
    doc.font('Helvetica-Bold')
       .text('_________________________', 370, 655);
    doc.font('Helvetica')
       .text('Name: ___________________', 370, 675);
    
    
    doc.fontSize(8)
       .fillColor('#9CA3AF')
       .text('This agreement is legally binding upon signature by all parties.', 50, 730, { align: 'center' })
       .text(`Generated by STAG Platform on ${new Date().toLocaleDateString()}`, 50, 745, { align: 'center' });
    
    doc.end();
    
    const pdfBuffer = await pdfPromise;
    console.log('✅ PDF generated, size:', pdfBuffer.length, 'bytes');
    
    await fs.writeFile(filePath, pdfBuffer);
    console.log('✅ PDF SAVED TO SERVER:', filePath);
    
    const db = require('../config/database');
    await db.execute('UPDATE agreements SET pdf_url = ? WHERE id = ?', [pdfUrl, agreementId]);
    console.log('✅ Database updated with PDF URL:', pdfUrl);
    
    return { success: true, filePath, pdfUrl };
    
  } catch (error) {
    console.error('❌ Error generating/saving PDF:', error);
    return { success: false, error: error.message };
  }
};

module.exports = router;