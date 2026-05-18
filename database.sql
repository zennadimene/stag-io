
CREATE DATABASE stag_io_platform;
USE stag_io_platform;


CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    user_type ENUM('student', 'company', 'admin') NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    is_suspended BOOLEAN DEFAULT FALSE, 
    verification_token VARCHAR(255),
    reset_password_token VARCHAR(255) NULL,
    reset_password_expires TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    full_name VARCHAR(255),
    role VARCHAR(100) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    university_email VARCHAR(255),
    phone VARCHAR(20),
    birth_date DATE,
    university VARCHAR(255),
    specialization VARCHAR(255),
    year_of_study VARCHAR(50),
    student_id VARCHAR(100),
    skills JSON,
    soft_skills JSON,
    github_link VARCHAR(255),
    linkedin_link VARCHAR(255),
    profile_image_url VARCHAR(255),
    wilaya VARCHAR(100),
    bio TEXT,
    training_type VARCHAR(50),
    preferred_wilaya VARCHAR(100),
    expected_start_date DATE,
    social_security VARCHAR(100) NULL,
    academic_supervisor VARCHAR(255) NULL,
    is_placed TINYINT(1) DEFAULT 0,
    placement_status VARCHAR(50) DEFAULT NULL,
    placement_date DATE DEFAULT NULL,
    placed_internship_id INT DEFAULT NULL,
    experiences JSON DEFAULT NULL COMMENT 'Work experience stored as JSON array', 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS companies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    company_email VARCHAR(255),
    phone VARCHAR(20),
    website VARCHAR(255),
    trade_register VARCHAR(100) UNIQUE,
    activity_sector VARCHAR(100),
    company_size VARCHAR(50),
    wilaya VARCHAR(100),
    address TEXT,
    contact_person VARCHAR(255),
    position VARCHAR(100),
    personal_email VARCHAR(255),
    description TEXT,
    logo_url VARCHAR(255),
    cover_image_url VARCHAR(255),
    founded_year INT,
    tax_id VARCHAR(100),
    social_media JSON,
    profile_completed BOOLEAN DEFAULT FALSE,
    average_rating DECIMAL(3,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS internships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(255),
    type ENUM('full-time', 'part-time', 'remote', 'hybrid') DEFAULT 'full-time',
    duration INT,
    stipend DECIMAL(10,2) DEFAULT 0,
    stipend_type ENUM('fixed', 'negotiable', 'unpaid') DEFAULT 'fixed',
    required_skills JSON,
    requirements TEXT,
    benefits TEXT,
    deadline DATE,
    start_date DATE NULL COMMENT 'Internship start date',
    end_date DATE NULL COMMENT 'Internship end date',
    positions_available INT DEFAULT 1,
    status ENUM('active', 'inactive', 'filled', 'closed') DEFAULT 'active',
    views_count INT DEFAULT 0 COMMENT 'Number of times this internship was viewed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;




-- إنشاء الجدول مع الحالة 'expired'
CREATE TABLE IF NOT EXISTS student_internships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    internship_id INT NOT NULL,
    status ENUM('pending', 'reviewed', 'interview', 'accepted', 'rejected', 'expired') DEFAULT 'pending',
    is_validated BOOLEAN DEFAULT FALSE,
    validated_at TIMESTAMP NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    feedback TEXT,
    interview_date DATE,
    interview_time TIME,
    interview_mode ENUM('online', 'in-person', 'phone') DEFAULT 'online',
    meeting_link VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (internship_id) REFERENCES internships(id) ON DELETE CASCADE,
    UNIQUE KEY unique_application (student_id, internship_id)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS agreements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    internship_id INT NOT NULL,
    status ENUM('pending', 'sent', 'signed', 'completed', 'archived') DEFAULT 'pending',
    generated_at TIMESTAMP NULL,
    sent_at TIMESTAMP NULL,
    signed_at TIMESTAMP NULL,
    archived_at TIMESTAMP NULL,
    pdf_url VARCHAR(255),
    university_name VARCHAR(255),
    
    student_signed BOOLEAN DEFAULT FALSE,
    signature_url VARCHAR(500) NULL COMMENT 'Student signature image path',
    signature_type ENUM('draw', 'type') NULL COMMENT 'Student signature type: draw or type',
    typed_name VARCHAR(255) NULL COMMENT 'Student typed name when signature_type is type',
    
    company_signed BOOLEAN DEFAULT FALSE,
    company_signed_at TIMESTAMP NULL COMMENT 'When company signed the agreement',
    company_signature_url VARCHAR(500) NULL COMMENT 'Company signature image path',
    company_signature_type ENUM('draw', 'type') NULL COMMENT 'Company signature type: draw or type',
    company_typed_name VARCHAR(255) NULL COMMENT 'Company typed name when signature_type is type',

    university_signed BOOLEAN DEFAULT FALSE COMMENT 'Whether university has signed',
    university_signed_at TIMESTAMP NULL COMMENT 'When university signed the agreement',
    university_signature_url VARCHAR(500) NULL COMMENT 'University signature image path',
    university_signature_type ENUM('draw', 'type') NULL COMMENT 'University signature type: draw or type',
    university_typed_name VARCHAR(255) NULL COMMENT 'University typed name when signature_type is type',
    
    completed_at TIMESTAMP NULL COMMENT 'When agreement was completed',

    data JSON NULL COMMENT 'Stores additional data like original_status before archiving, signature metadata, etc.',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (internship_id) REFERENCES internships(id) ON DELETE CASCADE
) ENGINE=InnoDB;



CREATE TABLE IF NOT EXISTS saved_internships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    internship_id INT NOT NULL,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (internship_id) REFERENCES internships(id) ON DELETE CASCADE,
    UNIQUE KEY unique_save (student_id, internship_id)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('application', 'interview', 'acceptance', 'rejection', 'agreement', 'system') DEFAULT 'system',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    application_id INT,
    agreement_id INT NULL, 
    data JSON,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE SET NULL
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS company_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    type ENUM('application', 'interview', 'acceptance', 'rejection', 'agreement', 'system') DEFAULT 'system',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    application_id INT,
    agreement_id INT NULL,
    data JSON,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE SET NULL
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS admin_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('application', 'interview', 'acceptance', 'rejection', 'agreement', 'system', 'company_accept') DEFAULT 'system',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    company_id INT NULL,
    student_id INT NULL,
    internship_id INT NULL,
    application_id INT NULL,
    agreement_id INT NULL,
    data JSON,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (internship_id) REFERENCES internships(id) ON DELETE SET NULL,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE SET NULL
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS company_ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    company_id INT NOT NULL,
    internship_id INT NOT NULL,
    agreement_id INT,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    would_recommend BOOLEAN DEFAULT TRUE,
    communication_rating INT,
    supervision_rating INT,
    learning_rating INT,
    work_environment_rating INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (internship_id) REFERENCES internships(id) ON DELETE CASCADE,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE SET NULL,
    UNIQUE KEY unique_rating (student_id, company_id, internship_id)
) ENGINE=InnoDB;




CREATE TABLE IF NOT EXISTS student_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    settings JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS internship_completions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agreement_id INT NOT NULL,
    student_id INT NOT NULL,
    company_id INT NOT NULL,
    certificate_url VARCHAR(255),
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_completion (agreement_id)
) ENGINE=InnoDB;






CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    internship_id INT NOT NULL,
    helpful BOOLEAN DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (internship_id) REFERENCES internships(id) ON DELETE CASCADE,
    UNIQUE KEY unique_feedback (student_id, internship_id)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS company_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL UNIQUE,
    settings JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agreement_id INT NOT NULL,
    document_type ENUM('agreement', 'certificate', 'acceptance_letter', 'evaluation_form') NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    generated_by INT NOT NULL COMMENT 'admin user id',
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_to_student BOOLEAN DEFAULT FALSE,
    sent_to_company BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP NULL,
    notes TEXT,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id) ON DELETE CASCADE,
    FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_agreement (agreement_id),
    INDEX idx_type (document_type)
) ENGINE=InnoDB;


INSERT INTO users (id, email, password, user_type, is_verified, created_at, updated_at) 
VALUES (1, 'admin@stag.com', '$2a$10$RB1x4.ggJx6VpJkDsDFhSedjtDRqIOohQKE1QnEdvV1e2.XM1GxzC', 'admin', 1, NOW(), NOW());
SHOW TABLES;$2a$10$3qgZAksydHTNZcAlingVBugKt0dIOS1tYcA/DWDvrWPO1DY2BXT2G