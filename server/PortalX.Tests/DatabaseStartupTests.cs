using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;
using PortalX.Server.Data;

namespace PortalX.Tests;

/// <summary>A broken database setting must not crash the server (it did on Render): it starts and explains.</summary>
public class DatabaseStartupTests : IClassFixture<DatabaseStartupTests.BrokenDbFactory>
{
    private const string FakeSecret = "npg_SHOULD_NEVER_APPEAR";

    public sealed class BrokenDbFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
            {
                // not a URL at all — e.g. a wrong value pasted into Render
                ["DATABASE_URL"] = "neondb " + FakeSecret,
            }));
        }
    }

    private readonly BrokenDbFactory _factory;
    public DatabaseStartupTests(BrokenDbFactory factory) => _factory = factory;

    [Fact]
    public async Task Server_starts_reports_a_safe_problem_and_blocks_game_endpoints()
    {
        var http = _factory.CreateClient();

        var health = await http.GetFromJsonAsync<JsonElement>("/api/health");
        Assert.Equal("degraded", health.GetProperty("status").GetString());
        Assert.Equal("error", health.GetProperty("database").GetString());
        var problem = health.GetProperty("problem").GetString()!;
        Assert.StartsWith("config:", problem);
        Assert.DoesNotContain(FakeSecret, problem);

        var create = await http.PostAsJsonAsync("/api/orders", new { productId = "last-portal" });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, create.StatusCode);
        Assert.Contains("מסד הנתונים", await create.Content.ReadAsStringAsync());

        // static content and the scenario description still work
        Assert.Equal(HttpStatusCode.OK, (await http.GetAsync("/api/scenarios")).StatusCode);
    }

    [Fact]
    public void Exceptions_are_classified_without_details()
    {
        Assert.StartsWith("auth-failed", DatabaseStartup.Classify(new PostgresException("password authentication failed", "FATAL", "FATAL", "28P01")));
        Assert.StartsWith("database-not-found", DatabaseStartup.Classify(new PostgresException("x", "FATAL", "FATAL", "3D000")));
        Assert.Equal("network: HostNotFound", DatabaseStartup.Classify(new NpgsqlException("x", new SocketException((int)SocketError.HostNotFound))));
        Assert.StartsWith("network: timeout", DatabaseStartup.Classify(new NpgsqlException("x", new TimeoutException())));
    }
}
