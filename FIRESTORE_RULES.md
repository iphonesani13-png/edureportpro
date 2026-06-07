# FIRESTORE SECURITY RULES (SMPIT TRACKER V2)

Copy and paste these rules into your Firebase Console (Firestore -> Rules tab) to enforce the Access Matrix V2 security.

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // --- HELPER FUNCTIONS ---
    
    function isSignedIn() {
      return request.auth != null;
    }
    
    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    
    function hasRole(role) {
      return isSignedIn() && getUserData().role == role;
    }
    
    function isOwner() { return hasRole('OWNER'); }
    function isSuperAdmin() { return hasRole('SUPER_ADMIN'); }
    function isKurikulum() { return hasRole('KURIKULUM'); }
    function isKepsek() { return hasRole('KEPALA_SEKOLAH'); }
    function isGuru() { return hasRole('GURU'); }
    
    function isStaff() {
      return isOwner() || isSuperAdmin() || isKurikulum() || isKepsek() || isGuru();
    }
    
    function managesSubject(subjectId) {
      return isStaff() && (isOwner() || isSuperAdmin() || isKurikulum() || subjectId in getUserData().managedSubjects);
    }

    // --- COLLECTION RULES ---

    // 1. USERS COLLECTION
    match /users/{userId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn() && request.resource.data.status == 'pending';
      allow update: if isOwner() || isSuperAdmin() || (request.auth.uid == userId && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'status', 'managedSubjects']));
    }

    // 2. AUTHORIZED USERS (WHITELIST)
    match /authorized_users/{docId} {
      allow read: if isSignedIn();
      allow write: if isOwner() || isSuperAdmin();
    }

    // 3. STUDENTS COLLECTION
    match /students/{studentId} {
      allow read: if isStaff() || (isSignedIn() && getUserData().childId == studentId);
      allow write: if isOwner() || isSuperAdmin();
    }

    // 4. ASSESSMENT TEMPLATES (TP/ATP)
    match /assessment_templates/{templateId} {
      allow read: if isStaff();
      allow create: if isStaff() && managesSubject(request.resource.data.subjectId);
      allow update: if isStaff() && managesSubject(resource.data.subjectId) && request.resource.data.status != 'deleted';
      allow delete: if isOwner();
    }

    // 5. ASSESSMENTS (GRADES)
    match /assessments/{assessmentId} {
      allow read: if isStaff() || (isSignedIn() && assessmentId.split('_')[0] == getUserData().childId);
      allow create: if isGuru() && managesSubject(request.resource.data.subjectId);
      allow update: if (isGuru() && managesSubject(resource.data.subjectId)) || isOwner() || isSuperAdmin();
      allow delete: if isOwner();
    }

    // 6. SUBJECTS (CP/KKM)
    match /subjects/{subjectId} {
      allow read: if isSignedIn();
      allow write: if isOwner() || isSuperAdmin() || isKurikulum() || managesSubject(subjectId);
    }
    
    // 7. CLASSES
    match /classes/{classId} {
      allow read: if isStaff();
      allow write: if isOwner() || isSuperAdmin();
    }
  }
}
```
