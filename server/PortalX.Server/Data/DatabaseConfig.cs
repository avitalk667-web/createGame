using System.Text.RegularExpressions;
using Npgsql;

namespace PortalX.Server.Data;

/// <summary>
/// Resolves the PostgreSQL connection string. Locally: ConnectionStrings:Default.
/// In the cloud: the DATABASE_URL environment variable, as copied from Neon / Render.
/// Accepted forms (secrets stay in the host's environment, never in the repository or the logs):
///   postgresql://user:password@host[:port]/db?sslmode=require&amp;channel_binding=require
///   psql 'postgresql://…'           (Neon's "psql" snippet — the command and quotes are stripped)
///   "postgresql://…" / 'postgresql://…' with surrounding quotes, spaces or line breaks
///   Host=…;Database=…;Username=…;Password=…   (Npgsql keyword form)
/// System.Uri is deliberately not used: it rejects these variants and passwords with reserved characters.
/// </summary>
public static partial class DatabaseConfig
{
    public static string Resolve(IConfiguration config)
    {
        var url = config["DATABASE_URL"];
        if (!string.IsNullOrWhiteSpace(url)) return FromSetting(url);
        return config.GetConnectionString("Default")
            ?? throw new InvalidOperationException("No database configured: set DATABASE_URL or ConnectionStrings:Default.");
    }

    [GeneratedRegex(@"postgres(?:ql)?://\S+", RegexOptions.IgnoreCase)]
    private static partial Regex EmbeddedUrl();

    // user[:password]@host[:port][/db][?query] — the password runs to the LAST '@', so it may contain '@', ':' or '/'.
    [GeneratedRegex(@"^postgres(?:ql)?://(?<user>[^:@/]*)(?::(?<pass>.*))?@(?<host>\[[^\]]+\]|[^:/?#@]+)(?::(?<port>\d+))?(?:/(?<db>[^?#]*))?(?:\?(?<query>[^#]*))?(?:#.*)?$", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex UrlParts();

    /// <summary>Accepts any of the supported forms and returns an Npgsql keyword connection string.</summary>
    public static string FromSetting(string raw)
    {
        var value = raw.Trim().Trim('"', '\'', '`').Trim();

        var embedded = EmbeddedUrl().Match(value);
        if (embedded.Success) return FromUrl(embedded.Value.TrimEnd('"', '\'', '`', ';'));

        if (value.Contains('=') && value.Contains(';'))
        {
            try
            {
                var b = new NpgsqlConnectionStringBuilder(value);
                if (string.IsNullOrEmpty(b.Host)) throw new ArgumentException("missing Host");
                return b.ConnectionString;
            }
            catch (ArgumentException e)
            {
                throw new InvalidOperationException($"DATABASE_URL looks like a keyword connection string but is invalid ({e.GetType().Name}). Paste the postgresql:// URL from Neon instead.");
            }
        }

        throw new InvalidOperationException(
            $"DATABASE_URL is not a PostgreSQL URL (length {value.Length}, no 'postgresql://' found). " +
            "In Neon open Connect and copy the connection string that starts with postgresql:// (not the psql command).");
    }

    public static string FromUrl(string url)
    {
        var m = UrlParts().Match(url.Trim());
        if (!m.Success)
            throw new InvalidOperationException("DATABASE_URL starts with postgresql:// but its user/host part could not be read. Copy it again from Neon without editing it.");

        var query = ParseQuery(m.Groups["query"].Value);
        var host = m.Groups["host"].Value.Trim('[', ']');
        var b = new NpgsqlConnectionStringBuilder
        {
            Host = host,
            Port = m.Groups["port"].Success ? int.Parse(m.Groups["port"].Value) : 5432,
            Database = Unescape(m.Groups["db"].Value) is { Length: > 0 } db ? db : "postgres",
            Username = Unescape(m.Groups["user"].Value),
            Password = m.Groups["pass"].Success ? Unescape(m.Groups["pass"].Value) : null,
            SslMode = (query.GetValueOrDefault("sslmode") ?? "require").ToLowerInvariant() switch
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
        if (query.TryGetValue("channel_binding", out var cb))
            b.ChannelBinding = cb.ToLowerInvariant() switch { "require" => ChannelBinding.Require, "disable" => ChannelBinding.Disable, _ => ChannelBinding.Prefer };
        return b.ConnectionString;
    }

    /// <summary>Description that is safe to log: never includes user, password or full host.</summary>
    public static string Describe(string connectionString)
    {
        try
        {
            var b = new NpgsqlConnectionStringBuilder(connectionString);
            var host = b.Host ?? "";
            var dot = host.IndexOf('.');
            return $"host *{(dot > 0 ? host[dot..] : "")}, port {b.Port}, database {(string.IsNullOrEmpty(b.Database) ? "?" : "set")}, ssl {b.SslMode}";
        }
        catch
        {
            return "unreadable connection string";
        }
    }

    private static Dictionary<string, string> ParseQuery(string q)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = part.Split('=', 2);
            d[Unescape(kv[0])] = kv.Length > 1 ? Unescape(kv[1]) : "";
        }
        return d;
    }

    private static string Unescape(string s)
    {
        try { return Uri.UnescapeDataString(s); }
        catch { return s; }
    }
}
