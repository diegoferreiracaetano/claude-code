export function greet(name: string) {
  return "Hello, " + name + "!";
}

export function isAdmin(user: any) {
  if (user.role == "admin") {
    return true;
  }
  return false;
}
