/** Same server and database as the platform connection, with the print advisor's own role. */
export function advisorConnectionString(platformUrl: string, user: string, password: string): string {
  const url = new URL(platformUrl);
  if (!user || !password || decodeURIComponent(url.username) === user) {
    throw new Error("The print advisor must use its own PostgreSQL role");
  }
  url.username = user;
  url.password = password;
  return url.toString();
}
