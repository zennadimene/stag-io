
const db = require('../config/database');  
const { sendEmail, emailTemplates } = require('../config/email');  

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

let io = null;
const activeUsers = new Map();

const setSocketIO = (socketIO) => {
    io = socketIO;
};

const setActiveUser = (userId, socketId) => {
    activeUsers.set(userId.toString(), socketId);
};

const removeActiveUser = (socketId) => {
    for (let [userId, sId] of activeUsers.entries()) {
        if (sId === socketId) {
            activeUsers.delete(userId);
            break;
        }
    }
};

const sendRealtime = (userId, notification) => {
    if (!io) return false;
    
    const socketId = activeUsers.get(userId.toString());
    if (socketId) {
        io.to(socketId).emit('notification', notification);
        return true;
    }
    return false;
};

const createNotification = async ({
    userId,
    userType,
    type,
    title,
    message,
    applicationId = null,
    agreementId = null,
    data = null,
    sendEmail = false,
    emailData = null
}) => {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        let notificationId;
        const dataString = data ? JSON.stringify(data) : null;
        
        switch(userType) {
            case 'student':
                const [studentResult] = await connection.execute(
                    `INSERT INTO notifications 
                     (user_id, type, title, message, application_id, agreement_id, data, is_read, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
                    [userId, type, title, message, applicationId, agreementId, dataString]
                );
                notificationId = studentResult.insertId;
                break;
                
            case 'company':
                const [companyResult] = await connection.execute(
                    `INSERT INTO company_notifications 
                     (company_id, type, title, message, application_id, agreement_id, data, is_read, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
                    [userId, type, title, message, applicationId, agreementId, dataString]
                );
                notificationId = companyResult.insertId;
                break;
                
            case 'admin':
                const [adminResult] = await connection.execute(
                    `INSERT INTO admin_notifications 
                     (type, title, message, company_id, student_id, internship_id, application_id, agreement_id, data, is_read, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
                    [
                        type, 
                        title, 
                        message, 
                        data?.companyId || null,
                        data?.studentId || null,
                        data?.internshipId || null,
                        applicationId,
                        agreementId,
                        dataString
                    ]
                );
                notificationId = adminResult.insertId;
                
                if (io) {
                    io.emit('admin-notification', {
                        id: notificationId,
                        type,
                        title,
                        message,
                        created_at: new Date(),
                        is_read: 0
                    });
                }
                break;
        }
        
        await connection.commit();
        
        const notification = {
            id: notificationId,
            type,
            title,
            message,
            application_id: applicationId,
            agreement_id: agreementId,
            data,
            is_read: 0,
            created_at: new Date()
        };
        
        if (userType !== 'admin') {
            sendRealtime(userId, notification);
        }
        
        if (sendEmail && emailData) {
            await sendEmail({
                to: emailData.to,
                subject: emailData.subject,
                html: emailData.html
            }).catch(err => console.error('Email failed:', err));
        }
        
        return notificationId;
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Error creating notification:', error);
        throw error;
    } finally {
        connection.release();
    }
};


const notifyNewApplication = async (applicationData) => {
    const { 
        applicationId, 
        studentId, 
        studentName, 
        companyId, 
        companyName,
        internshipId,
        internshipTitle 
    } = applicationData;
    
    
    await createNotification({
        userId: companyId,
        userType: 'company',
        type: 'application',
        title: '📬 New Application Received',
        message: `Student ${studentName} has applied for "${internshipTitle}"`,
        applicationId,
        data: { studentId, internshipId, studentName },
        sendEmail: true,
        emailData: {
            to: companyId, 
            subject: 'New Application - Stag.io',
            html: `<h2>New Application</h2>
                   <p>Student ${studentName} has applied for "${internshipTitle}"</p>
                   <a href="http://localhost:3000/company/applications">View Applications</a>`
        }
    });
    
    
    await createNotification({
        userId: studentId,
        userType: 'student',
        type: 'application',
        title: '✅ Application Submitted',
        message: `Your application for "${internshipTitle}" at ${companyName} has been submitted successfully`,
        applicationId
    });
};



const notifyAdminValidation = async (validationData) => {
    const {
        applicationId,
        studentId,
        studentName,
        companyId,
        companyName,
        internshipTitle
    } = validationData;

    
    await createNotification({
        userId: studentId,
        userType: 'student',
        type: 'validation',
        title: '✅ Internship Validated!',
        message: `Your internship "${internshipTitle}" at ${companyName} has been validated by the administration.`,
        applicationId
    });

    
    await createNotification({
        userId: companyId,
        userType: 'company',
        type: 'validation',
        title: '✅ Internship Validated',
        message: `The internship for ${studentName} has been validated.`,
        applicationId
    });

    
    await createNotification({
        userType: 'admin',
        type: 'validation_complete',
        title: '✅ Validation Complete',
        message: `Internship validated for ${studentName} at ${companyName}`,
        applicationId,
        data: { studentId, companyId }
    });
};


const notifyAgreementGenerated = async (agreementData) => {
    const {
        agreementId,
        studentId,
        studentName,
        studentEmail,
        companyId,
        companyName,
        internshipTitle,
        pdfUrl
    } = agreementData;
    
    
    await createNotification({
        userId: studentId,
        userType: 'student',
        type: 'agreement',
        title: '📄 Agreement Ready for Signature',
        message: `Your internship agreement with ${companyName} for "${internshipTitle}" is ready`,
        agreementId,
        sendEmail: true,
        emailData: {
            to: studentEmail,
            subject: 'Internship Agreement Ready - Stag.io',
            html: `
                <div>
                    <h2>Agreement Ready for Signature</h2>
                    <p>Dear ${studentName},</p>
                    <p>Your internship agreement with ${companyName} for "${internshipTitle}" is ready.</p>
                    <p>You can now:</p>
                    <ul>
                        <li><a href="http://localhost:3000${pdfUrl}">View Agreement</a></li>
                        <li><a href="http://localhost:3000/student/agreements/${agreementId}/sign">Sign Agreement</a></li>
                    </ul>
                </div>
            `
        }
    });
    

    await createNotification({
        userId: companyId,
        userType: 'company',
        type: 'agreement',
        title: '📄 Agreement Generated',
        message: `Agreement for ${studentName} has been generated`,
        agreementId
    });
};


const notifyAgreementSigned = async (signatureData) => {
    const {
        agreementId,
        studentId,
        studentName,
        companyId,
        companyName,
        internshipTitle
    } = signatureData;
    
    
    await createNotification({
        userId: companyId,
        userType: 'company',
        type: 'agreement_signed',
        title: '✍️ Agreement Signed by Student',
        message: `${studentName} has signed the agreement for "${internshipTitle}"`,
        agreementId
    });
    
    
    await createNotification({
        userType: 'admin',
        type: 'agreement_signed',
        title: '📄 Agreement Signed',
        message: `${studentName} has signed the agreement with ${companyName}`,
        agreementId,
        data: {
            studentId,
            companyId,
            studentName,
            companyName,
            internshipTitle
        }
    });
};


const notifyCompanySigned = async (signatureData) => {
    const {
        agreementId,
        studentId,
        studentName,
        companyId,
        companyName,
        internshipTitle
    } = signatureData;
    
    
    await createNotification({
        userId: studentId,
        userType: 'student',
        type: 'agreement_signed',
        title: '✍️ Company Signed Agreement',
        message: `${companyName} has signed the agreement for "${internshipTitle}"`,
        agreementId
    });
    
    
    await createNotification({
        userType: 'admin',
        type: 'agreement_signed',
        title: '📄 Company Signed Agreement',
        message: `${companyName} has signed the agreement with ${studentName}`,
        agreementId,
        data: {
            studentId,
            companyId,
            studentName,
            companyName,
            internshipTitle
        }
    });
};


const notifyInternshipCompleted = async (completionData) => {
    const {
        agreementId,
        studentId,
        studentName,
        studentEmail,
        companyId,
        companyName,
        internshipTitle,
        certificateUrl
    } = completionData;

    
    await createNotification({
        userId: studentId,
        userType: 'student',
        type: 'internship_completed',
        title: '🎓 Internship Completed!',
        message: `Congratulations! You have successfully completed your internship at ${companyName} for "${internshipTitle}".`,
        agreementId,
        sendEmail: true,
        emailData: {
            to: studentEmail,
            subject: '🎉 Congratulations on Completing Your Internship!',
            html: `
                <div style="text-align: center;">
                    <h1 style="color: #6b46c1;">🎓 Congratulations ${studentName}!</h1>
                    <p>You have successfully completed your internship at</p>
                    <h2 style="color: #4F46E5;">${companyName}</h2>
                    <p>for the position of</p>
                    <h3>${internshipTitle}</h3>
                    ${certificateUrl ? `
                        <p>Your certificate is now available:</p>
                        <a href="${BASE}${certificateUrl}" 
                           style="background: #6b46c1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                            📜 Download Certificate
                        </a>
                    ` : ''}
                </div>
            `
        }
    });

    
    await createNotification({
        userId: companyId,
        userType: 'company',
        type: 'internship_completed',
        title: '🎓 Internship Completed',
        message: `${studentName} has completed their internship at your company for "${internshipTitle}".`,
        agreementId
    });

    
    await createNotification({
        userType: 'admin',
        type: 'internship_completed',
        title: '🎓 Internship Completed',
        message: `${studentName} has completed internship at ${companyName} for "${internshipTitle}".`,
        agreementId,
        data: { studentId, companyId, internshipTitle }
    });
};


const notifyNewCompany = async (companyData) => {
    const {
        companyId,
        companyName,
        companyEmail,
        contactPerson,
        tradeRegister
    } = companyData;

    
    await createNotification({
        userType: 'admin',
        type: 'company_register',
        title: '🏢 New Company Registration',
        message: `${companyName} has registered and is waiting for verification.`,
        data: {
            companyId,
            companyName,
            companyEmail,
            contactPerson,
            tradeRegister
        }
    });
};


const notifyCompanyApproved = async (approvalData) => {
    const {
        companyId,
        companyName,
        companyEmail
    } = approvalData;

    
    await createNotification({
        userId: companyId,
        userType: 'company',
        type: 'company_approved',
        title: '✅ Company Account Approved',
        message: `Congratulations! Your company "${companyName}" has been verified. You can now post internships.`,
        sendEmail: true,
        emailData: {
            to: companyEmail,
            subject: 'Company Account Approved - Stag.io',
            html: `
                <div>
                    <h2>Congratulations ${companyName}!</h2>
                    <p>Your company account has been approved by our team.</p>
                    <p>You can now:</p>
                    <ul>
                        <li>Post internship opportunities</li>
                        <li>Review student applications</li>
                        <li>Manage your company profile</li>
                    </ul>
                    <a href="http://localhost:3000/company/dashboard">Go to Dashboard</a>
                </div>
            `
        }
    });
};

module.exports = {
    setSocketIO,
    setActiveUser,
    removeActiveUser,
    createNotification,
    notifyNewApplication,
    notifyAdminValidation,
    notifyAgreementGenerated,
    notifyAgreementSigned,
    notifyCompanySigned,
    notifyInternshipCompleted,
    notifyNewCompany,
    notifyCompanyApproved
};