/**
 * Maps Rails application roles to our application roles
 * Rails roles: "Ark Admin", "Diocese Executive", "Diocese Admin", "Center Admin", 
 *              "Center Data Admin", "Teacher", "Proctor", "Student", "Catechist Candidate"
 * Our roles: "super_admin", "diocese_manager", "school_manager"
 */

type RailsRole = 
  | "Ark Admin" 
  | "Diocese Executive" 
  | "Diocese Admin" 
  | "Center Admin" 
  | "Center Data Admin" 
  | "Teacher" 
  | "Proctor" 
  | "Student" 
  | "Catechist Candidate";

type OurRole = "super_admin" | "diocese_manager" | "school_manager";

/**
 * Maps a Rails application role to the equivalent role in our application
 * @param railsRole The role from the Rails application
 * @returns The equivalent role in our application
 */
export function mapRailsRoleToOurRole(railsRole: RailsRole): OurRole {
  switch (railsRole) {
    case "Ark Admin":
      return "super_admin";
    case "Diocese Executive":
    case "Diocese Admin":
      return "diocese_manager";
    case "Center Admin":
    case "Center Data Admin":
    case "Teacher":
    case "Proctor":
      return "school_manager";
    // Students and Catechist Candidates aren't meant to access this app
    default:
      return "school_manager";
  }
}

/**
 * Determines if a Rails role should have access to our application
 * @param railsRole The role from the Rails application
 * @returns True if the role should have access, false otherwise
 */
export function railsRoleShouldHaveAccess(railsRole: RailsRole): boolean {
  // Students and Catechist Candidates aren't meant to access this app
  return railsRole !== "Student" && railsRole !== "Catechist Candidate";
} 