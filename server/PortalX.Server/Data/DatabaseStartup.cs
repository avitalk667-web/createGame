using System.Net.Sockets;
using System.Security.Authentication;
using Npgsql;
using PortalX.Server.Content;

namespace PortalX.Server.Data;

/// <summary>Database readiness, shown (without any secret) by /api/health.</summary>
public sealed class DatabaseStatus
{
    public string State { get; private set; } = "starting";
    public string? Problem { get; private set; }
    public int Attempts { get; private set; }
    public DateTime? ReadySince { get; private set; }
    public bool IsReady => State == "ready";

    public void Ready() { State = "ready"; Problem = null; ReadySince = DateTime.UtcNow; }
    public void Failed(string problem) { State = "error"; Problem = problem; }
    public void Attempted() => Attempts++;
}

/// <summary>
/// Creates the schema and seeds content. A database problem no longer kills the process:
/// the web server starts, reports a safe diagnosis on /api/health and keeps retrying
/// (also covers Neon's scale-to-zero wake-up and short network outages).
/// </summary>
public static class DatabaseStartup
{
    public static async Task<bool> TryInitializeAsync(IServiceProvider services, ILogger logger)
    {
        var status = services.GetRequiredService<DatabaseStatus>();
        status.Attempted();
        try
        {
            var config = services.GetRequiredService<IConfiguration>();
            logger.LogInformation("Database: {Target}", DatabaseConfig.Describe(DatabaseConfig.Resolve(config)));
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            await PortalDbContext.InitializeAsync(db, scope.ServiceProvider.GetRequiredService<ScenarioCatalog>(),
                scope.ServiceProvider.GetRequiredService<List<ProductSeed>>());
            status.Ready();
            logger.LogInformation("Database ready (attempt {Attempt}).", status.Attempts);
            return true;
        }
        catch (Exception ex)
        {
            var problem = Classify(ex);
            status.Failed(problem);
            // Npgsql messages never contain the password or the connection string.
            logger.LogCritical(ex, "Database not available (attempt {Attempt}): {Problem}", status.Attempts, problem);
            return false;
        }
    }

    public static void RetryInBackground(IServiceProvider services, ILogger logger, CancellationToken stop) =>
        _ = Task.Run(async () =>
        {
            var delay = TimeSpan.FromSeconds(10);
            while (!stop.IsCancellationRequested && !services.GetRequiredService<DatabaseStatus>().IsReady)
            {
                try { await Task.Delay(delay, stop); } catch (TaskCanceledException) { return; }
                if (await TryInitializeAsync(services, logger)) return;
                delay = TimeSpan.FromSeconds(Math.Min(60, delay.TotalSeconds * 1.5));
            }
        }, stop);

    /// <summary>Maps an exception to a short category that is safe to show publicly.</summary>
    public static string Classify(Exception ex)
    {
        for (var e = ex; e != null; e = e.InnerException)
        {
            switch (e)
            {
                case InvalidOperationException when e.Source == typeof(DatabaseConfig).Assembly.GetName().Name && e.Message.Contains("DATABASE_URL"):
                    return "config: " + e.Message;
                case PostgresException pg:
                    return pg.SqlState switch
                    {
                        "28P01" => "auth-failed: wrong user or password in DATABASE_URL",
                        "28000" => "auth-rejected: the database refused the login (check user / channel_binding)",
                        "3D000" => "database-not-found: the database name in DATABASE_URL does not exist",
                        "42501" => "permission-denied: the user cannot create tables",
                        _ => $"postgres-error {pg.SqlState}",
                    };
                case AuthenticationException:
                    return "ssl: the secure connection to the database failed";
                case SocketException se:
                    return $"network: {se.SocketErrorCode}";
                case TimeoutException:
                    return "network: timeout while connecting to the database";
            }
        }
        return ex is NpgsqlException ? "database-connection-error" : "unexpected: " + ex.GetType().Name;
    }
}
