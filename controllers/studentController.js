const db = require('../config/database'); 
const Student = require('../models/Student');
const fs = require('fs');
const path = require('path');

const getProfile = async (req, res) => {
    try {
        const student = await Student.getProfileWithFiles(req.user.id);
        
        if (!student) {
            return res.status(404).json({ message: 'Student profile not found' });
        }

        if (typeof student.skills === 'string') {
            try {
                student.skills = JSON.parse(student.skills);
            } catch (e) {
                student.skills = [];
            }
        }

        res.json({
            success: true,
            profile: {
                ...student,
                
                github_url: student.github_link || '',
                portfolio_url: student.linkedin_link || ''
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

const updateProfile = async (req, res) => {
    try {
        const updates = { ...req.body };
        
        console.log('📥 Received from frontend:', updates);
        console.log('📥 Content-Type:', req.headers['content-type']);
        
        delete updates.user_id;
        delete updates.university_email;
        delete updates.created_at;
        delete updates.profile_image_url;
        //delete updates.cv_url;
        delete updates.id;
        
        const dbUpdates = {};
        
if (updates.first_name && updates.first_name.trim() !== '') 
    dbUpdates.first_name = updates.first_name.trim();
if (updates.last_name && updates.last_name.trim() !== '') 
    dbUpdates.last_name = updates.last_name.trim();
if (updates.university && updates.university.trim() !== '') 
    dbUpdates.university = updates.university.trim();
if (updates.specialization && updates.specialization.trim() !== '') 
    dbUpdates.specialization = updates.specialization.trim();
if (updates.year_of_study && updates.year_of_study.trim() !== '') 
    dbUpdates.year_of_study = updates.year_of_study.trim();
if (updates.wilaya && updates.wilaya.trim() !== '') 
    dbUpdates.wilaya = updates.wilaya.trim();
if (updates.phone && updates.phone.trim() !== '') 
    dbUpdates.phone = updates.phone.trim();
if (updates.bio && updates.bio.trim() !== '') 
    dbUpdates.bio = updates.bio.trim();
if (updates.social_security && updates.social_security.trim() !== '')  
    dbUpdates.social_security = updates.social_security.trim();          
if (updates.academic_supervisor && updates.academic_supervisor.trim() !== '')  
    dbUpdates.academic_supervisor = updates.academic_supervisor.trim();        

if (updates.github_url && updates.github_url.trim() !== '') 
    dbUpdates.github_link = updates.github_url.trim();

if (updates.portfolio_url && updates.portfolio_url.trim() !== '') 
    dbUpdates.linkedin_link = updates.portfolio_url.trim();
        
        if (updates.skills) {
            if (typeof updates.skills === 'string') {
                try {
                    dbUpdates.skills = JSON.parse(updates.skills);
                } catch (e) {
                    dbUpdates.skills = updates.skills.split(',')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);
                }
            } else if (Array.isArray(updates.skills)) {
                dbUpdates.skills = updates.skills;
            }
        }

        if (updates.birth_date && updates.birth_date.trim() !== '') 
    dbUpdates.birth_date = updates.birth_date.trim();

if (updates.soft_skills) {
    if (typeof updates.soft_skills === 'string') {
        try {
            dbUpdates.soft_skills = JSON.parse(updates.soft_skills);
        } catch (e) {
            dbUpdates.soft_skills = updates.soft_skills.split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);
        }
    } else if (Array.isArray(updates.soft_skills)) {
        dbUpdates.soft_skills = updates.soft_skills;
    }
}
        
        console.log('📤 Sending to database:', dbUpdates);
        
        if (Object.keys(dbUpdates).length === 0) {
            console.log('⚠️ No changes to update');
            const student = await Student.getProfileWithFiles(req.user.id);
            return res.json({
                success: true,
                message: 'No changes detected',
                profile: {
                    ...student,
                    github_url: student.github_link || '',
                    portfolio_url: student.linkedin_link || '',
                }
            });
        }
        
        const updated = await Student.updateProfile(req.user.id, dbUpdates);
        
        const student = await Student.getProfileWithFiles(req.user.id);

        res.json({
            success: true,
            message: 'Profile updated successfully',
            profile: {
                ...student,
                github_url: student.github_link || '',
                portfolio_url: student.linkedin_link || '',
                soft_skills: student.soft_skills || []
            }
        });
        
    } catch (error) {
        console.error('🔥 Update profile error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
};

const uploadProfileImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'No file uploaded' 
            });
        }

        const student = await Student.findByUserId(req.user.id);
        
        if (!student) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student profile not found' 
            });
        }

        if (student.profile_image_url) {
            const oldImagePath = path.join(__dirname, '..', student.profile_image_url);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
            }
        }

        const profileImageUrl = `/uploads/profiles/${req.file.filename}`;
        await Student.updateProfileImage(req.user.id, profileImageUrl);

        res.json({
            success: true,
            message: 'Profile image uploaded successfully',
            profile_image_url: profileImageUrl
        });
    } catch (error) {
        console.error('Upload profile image error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};



const deleteProfileImage = async (req, res) => {
    try {
        const student = await Student.findByUserId(req.user.id);
        
        if (!student) {
            return res.status(404).json({ 
                success: false, 
                message: 'Student profile not found' 
            });
        }

        if (student.profile_image_url) {
            
            const imagePath = path.join(__dirname, '..', student.profile_image_url);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
            
            await Student.updateProfileImage(req.user.id, null);
        }

        res.json({ 
            success: true, 
            message: 'Profile image deleted successfully' 
        });
    } catch (error) {
        console.error('Delete profile image error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};





const savePreferences = async (req, res) => {
    try {
        const userId = req.user.id;
        
        console.log('📝 Full request body:', JSON.stringify(req.body, null, 2));
        
        let preferencesData;
        
        if (req.body.preferences) {
            
            preferencesData = req.body.preferences;
        } else {
          
            preferencesData = req.body;
        }
        
        const { 
            preferredLocations, 
            internshipTypes, 
            minStipend,
            language,
            theme,
            notificationFrequency 
        } = preferencesData;

        console.log('📍 preferredLocations:', preferredLocations);
        console.log('📋 internshipTypes:', internshipTypes);
        console.log('💰 minStipend:', minStipend);

        let preferredWilaya = null;
        if (preferredLocations && preferredLocations.length > 0) {
            if (preferredLocations.includes('Remote')) {
                preferredWilaya = 'Remote';
            } else {
                preferredWilaya = preferredLocations[0];
            }
        }
        
        let trainingType = null;
        if (internshipTypes && internshipTypes.length > 0) {
            trainingType = internshipTypes[0];
        }

        console.log('📝 Calculated preferred_wilaya:', preferredWilaya);
        console.log('📝 Calculated training_type:', trainingType);

        if (preferredWilaya || trainingType) {
            const [updateResult] = await db.execute(
                `UPDATE students 
                 SET preferred_wilaya = ?,
                     training_type = ?,
                     updated_at = NOW()
                 WHERE user_id = ?`,
                [preferredWilaya, trainingType, userId]
            );
            console.log('✅ Students table update result:', updateResult);
        } else {
            console.log('⚠️ No updates for students table');
        }

        const [existingSettings] = await db.execute(
            'SELECT settings FROM student_settings WHERE user_id = ?',
            [userId]
        );
        
        let currentSettings = {};
        if (existingSettings.length > 0) {
            try {
                currentSettings = JSON.parse(existingSettings[0].settings);
            } catch (e) {
                currentSettings = {};
            }
        }
        
        const settings = {
            account: currentSettings.account || {
                emailNotifications: true,
                applicationUpdates: true,
                deadlineReminders: true,
                newMatches: true,
                newsletter: false
            },
            privacy: currentSettings.privacy || {
                profileVisibility: 'public',
                showContactInfo: true,
                allowMessages: true,
                showSavedInternships: false,
                showApplications: true,
                dataSharing: true
            },
            preferences: {
                preferredLocations: preferredLocations || [],
                internshipTypes: internshipTypes || [],
                minStipend: minStipend || 0,
                notificationFrequency: notificationFrequency || 'instant',
                language: language || 'en',
                theme: theme || 'light'
            }
        };

        const [settingsResult] = await db.execute(
            `INSERT INTO student_settings (user_id, settings, updated_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE 
             settings = VALUES(settings),
             updated_at = NOW()`,
            [userId, JSON.stringify(settings)]
        );
        
        console.log('✅ Settings saved successfully');
        
        res.json({
            success: true,
            message: 'Preferences saved successfully',
            settings: settings
        });

    } catch (error) {
        console.error('❌ Error saving preferences:', error);
        res.status(500).json({
            success: false,
            message: 'Error saving preferences',
            error: error.message
        });
    }
};

const getPreferences = async (req, res) => {
    try {
        const userId = req.user.id;

        console.log('🔍 Fetching preferences for user:', userId);

        const [settings] = await db.execute(
            'SELECT settings FROM student_settings WHERE user_id = ?',
            [userId]
        );

        if (settings.length === 0) {
            console.log('⚠️ No preferences found, using default settings');
            
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
            return res.json({
                success: true,
                settings: defaultSettings
            });
        }

        let settingsData;
        try {
            settingsData = JSON.parse(settings[0].settings);
            
            if (!settingsData.account) {
                settingsData.account = {
                    emailNotifications: true,
                    applicationUpdates: true,
                    deadlineReminders: true,
                    newMatches: true,
                    newsletter: false
                };
            }
            if (!settingsData.privacy) {
                settingsData.privacy = {
                    profileVisibility: 'public',
                    showContactInfo: true,
                    allowMessages: true,
                    showSavedInternships: false,
                    showApplications: true,
                    dataSharing: true
                };
            }
            if (!settingsData.preferences) {
                settingsData.preferences = {
                    preferredLocations: [],
                    internshipTypes: ['remote', 'part-time', 'full-time'],
                    minStipend: 0,
                    notificationFrequency: 'instant',
                    language: 'en',
                    theme: 'light'
                };
            }
        } catch (parseError) {
            console.error('Error parsing settings:', parseError);
            
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
            return res.json({
                success: true,
                settings: defaultSettings
            });
        }
        
        console.log('✅ Preferences fetched successfully for user:', userId);
        
        res.json({
            success: true,
            settings: settingsData
        });

    } catch (error) {
        console.error('❌ Error fetching preferences:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching preferences',
            error: error.message
        });
    }
};

module.exports = {
    getProfile,
    updateProfile,
    uploadProfileImage,
    deleteProfileImage,
    savePreferences,
    getPreferences
};