import bcrypt from 'bcryptjs';

/**
 * Generates a Devise-compatible bcrypt hash for a password
 * Devise uses the format $2a$[cost]$[22 chars salt][31 chars hash]
 * 
 * @param password - The plaintext password to hash
 * @returns A Devise-compatible bcrypt password hash
 */
export function generateDeviseCompatiblePassword(password: string): Promise<string> {
  // Devise defaults to a cost factor of 11
  const saltRounds = 11;
  
  return new Promise((resolve, reject) => {
    bcrypt.genSalt(saltRounds, (err, salt) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Ensure salt is defined before passing to hash
      if (!salt) {
        reject(new Error('Failed to generate salt'));
        return;
      }
      
      bcrypt.hash(password, salt, (err, hash) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Ensure hash is defined
        if (!hash) {
          reject(new Error('Failed to generate hash'));
          return;
        }
        
        // Make sure the hash is in the expected format for Devise
        // Devise uses $2a$ prefix, while some bcrypt implementations might use $2b$
        // Replace to ensure compatibility
        const deviseHash = hash.replace(/^\$2\w\$/, '$2a$');
        resolve(deviseHash);
      });
    });
  });
}

/**
 * Checks if a plaintext password matches a Devise-encrypted password
 * 
 * @param plainPassword - The plaintext password to check
 * @param hashedPassword - The bcrypt hash from Devise
 * @returns A boolean indicating if the password matches
 */
export function checkDevisePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // Check if the hash is in the expected bcrypt format
    if (!hashedPassword.startsWith('$2')) {
      console.log('Warning: Password hash does not appear to be bcrypt format');
      // If it's not in bcrypt format, try direct string comparison as fallback
      // This handles the case where plaintext passwords were stored
      const passwordMatches = plainPassword === hashedPassword;
      console.log('Using direct comparison fallback:', passwordMatches);
      return resolve(passwordMatches);
    }
    
    // Make sure we're using the same format
    const fixedHash = hashedPassword.replace(/^\$2\w\$/, '$2a$');
    console.log('Using bcrypt comparison with hash format:', fixedHash.substring(0, 10) + '...');
    
    bcrypt.compare(plainPassword, fixedHash, (err, result) => {
      if (err) {
        console.error('Bcrypt comparison error:', err);
        reject(err);
        return;
      }
      
      console.log('Bcrypt comparison result:', result);
      // Ensure result is defined
      resolve(result === true);
    });
  });
} 