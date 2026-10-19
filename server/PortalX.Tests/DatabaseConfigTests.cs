using Npgsql;
using PortalX.Server.Data;

namespace PortalX.Tests;

public class DatabaseConfigTests
{
    [Fact]
    public void Neon_style_url_becomes_an_ssl_connection_string()
    {
        var cs = new NpgsqlConnectionStringBuilder(DatabaseConfig.FromUrl(
            "postgresql://portal_owner:p%40ss%3Aword@ep-cool-name-123.eu-central-1.aws.neon.tech/portalx?sslmode=require&channel_binding=require"));
        Assert.Equal("ep-cool-name-123.eu-central-1.aws.neon.tech", cs.Host);
        Assert.Equal(5432, cs.Port);
        Assert.Equal("portalx", cs.Database);
        Assert.Equal("portal_owner", cs.Username);
        Assert.Equal("p@ss:word", cs.Password);
        Assert.Equal(SslMode.Require, cs.SslMode);
    }

    [Fact]
    public void Explicit_port_and_disabled_ssl_are_respected()
    {
        var cs = new NpgsqlConnectionStringBuilder(DatabaseConfig.FromUrl("postgres://u:p@localhost:5433/db?sslmode=disable"));
        Assert.Equal(5433, cs.Port);
        Assert.Equal(SslMode.Disable, cs.SslMode);
    }

    [Fact]
    public void Non_postgres_urls_are_rejected() =>
        Assert.Throws<InvalidOperationException>(() => DatabaseConfig.FromUrl("mysql://u:p@h/db"));
}
