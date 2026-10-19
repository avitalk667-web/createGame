using Npgsql;
using PortalX.Server.Data;

namespace PortalX.Tests;

public class DatabaseConfigTests
{
    // Fake credentials only — the shape matches what Neon's Connect dialog produces.
    private const string NeonUrl =
        "postgresql://neondb_owner:npg_FAKEfake123@ep-winter-mode-a1b2c3d4-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

    private static NpgsqlConnectionStringBuilder Parse(string s) => new(DatabaseConfig.FromSetting(s));

    [Fact]
    public void Neon_url_becomes_an_ssl_connection_string()
    {
        var cs = Parse(NeonUrl);
        Assert.Equal("ep-winter-mode-a1b2c3d4-pooler.eu-central-1.aws.neon.tech", cs.Host);
        Assert.Equal(5432, cs.Port);
        Assert.Equal("neondb", cs.Database);
        Assert.Equal("neondb_owner", cs.Username);
        Assert.Equal("npg_FAKEfake123", cs.Password);
        Assert.Equal(SslMode.Require, cs.SslMode);
        Assert.Equal(ChannelBinding.Require, cs.ChannelBinding);
    }

    [Theory]
    [InlineData("psql '" + NeonUrl + "'")]                 // Neon's psql snippet
    [InlineData("'" + NeonUrl + "'")]                       // single quotes
    [InlineData("\"" + NeonUrl + "\"")]                     // double quotes
    [InlineData("  " + NeonUrl + "\n")]                     // spaces / trailing line break
    [InlineData("DATABASE_URL=" + NeonUrl)]                 // pasted with the variable name
    public void Common_copy_paste_variants_are_accepted(string pasted)
    {
        var cs = Parse(pasted);
        Assert.Equal("neondb", cs.Database);
        Assert.Equal("npg_FAKEfake123", cs.Password);
    }

    [Fact]
    public void Password_with_reserved_characters_is_kept()
    {
        var cs = Parse("postgres://u:p@ss/w:rd#1@db.example.com:6543/app?sslmode=disable");
        Assert.Equal("p@ss/w:rd#1", cs.Password);
        Assert.Equal("db.example.com", cs.Host);
        Assert.Equal(6543, cs.Port);
        Assert.Equal(SslMode.Disable, cs.SslMode);
    }

    [Fact]
    public void Percent_encoded_password_is_decoded()
    {
        Assert.Equal("p@ss:word", Parse("postgresql://u:p%40ss%3Aword@h.example.com/db").Password);
    }

    [Fact]
    public void Keyword_connection_string_is_accepted()
    {
        var cs = Parse("Host=h.example.com;Database=db;Username=u;Password=x;SSL Mode=Require");
        Assert.Equal("h.example.com", cs.Host);
    }

    [Theory]
    [InlineData("mysql://u:p@h/db")]
    [InlineData("just some text")]
    [InlineData("neondb")]
    public void Invalid_values_fail_without_revealing_them(string value)
    {
        var ex = Assert.Throws<InvalidOperationException>(() => DatabaseConfig.FromSetting(value));
        Assert.DoesNotContain(value, ex.Message);
    }

    [Fact]
    public void Description_for_logs_hides_credentials_and_host_name()
    {
        var d = DatabaseConfig.Describe(DatabaseConfig.FromSetting(NeonUrl));
        Assert.DoesNotContain("npg_FAKE", d);
        Assert.DoesNotContain("neondb_owner", d);
        Assert.DoesNotContain("ep-winter-mode", d);
        Assert.Contains("ssl Require", d);
    }
}
