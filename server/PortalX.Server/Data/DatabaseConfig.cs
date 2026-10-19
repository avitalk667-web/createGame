using Npgsql;

namespace PortalX.Server.Data;

/// <summary>
/// Resolves the PostgreSQL connection string. Locally: ConnectionStrings:Default.
/// In the cloud: the DATABASE_URL environment variable (postgres://user:password@host/db?sslmode=require),
/// as given by Neon / Render — secrets stay in the host's environment, never in the repository.
/// </summary>
public static class DatabaseConfig
{
    public static string Resolve(IConfiguration config)
    {
        var url = config["DATABASE_URL"];
        if (!string.IsNullOrWhiteSpace(url)) return FromUrl(url);
        return config.GetConnectionString("Default")
            ?? throw new InvalidOperationException("No database configured: set DATABASE_URL or ConnectionStrings:Default.");
    }

    public static string FromUrl(string url)
    {
        var uri = new Uri(url.Trim());
        if (uri.Scheme is not ("postgres" or "postgresql")) throw new InvalidOperationException("DATABASE_URL must start with postgres:// or postgresql://");
        var userInfo = uri.UserInfo.Split(':', 2);
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        var b = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port <= 0 ? 5432 : uri.Port,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
            SslMode = (query["sslmode"] ?? "require").ToLowerInvariant() switch
            {
                "disable" => SslMode.Disable,
                "allow" => SslMode.Allow,
                "prefer" => SslMode.Prefer,
                "verify-ca" => SslMode.VerifyCA,
                "verify-full" => SslMode.VerifyFull,
                _ => SslMode.Require,
            },
            // small free-tier databases: keep the pool modest
            MaxPoolSize = 20,
            Timeout = 30,
        };
        return b.ConnectionString;
    }
}
