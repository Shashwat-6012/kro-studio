using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Caching.Distributed;
using System.Security.Cryptography;

namespace KroStudio.Web.Infrastructure.Auth;

/// <summary>Stores authentication tickets server-side and leaves only an opaque session key in the browser cookie.</summary>
public sealed class DistributedCacheTicketStore(IDistributedCache cache) : ITicketStore
{
    private const string Prefix = "KroStudio:AuthTicket:";
    private static readonly TimeSpan DefaultLifetime = TimeSpan.FromHours(8);

    /// <inheritdoc />
    public async Task<string> StoreAsync(AuthenticationTicket ticket)
    {
        // 32 random bytes provide the design's 256-bit opaque browser ticket key.
        string key = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        await SaveAsync(key, ticket).ConfigureAwait(false);
        return key;
    }

    /// <inheritdoc />
    public Task RenewAsync(string key, AuthenticationTicket ticket) => SaveAsync(key, ticket);

    /// <inheritdoc />
    public async Task<AuthenticationTicket?> RetrieveAsync(string key)
    {
        byte[]? data = await cache.GetAsync(Prefix + key).ConfigureAwait(false);
        return data is null ? null : TicketSerializer.Default.Deserialize(data);
    }

    /// <inheritdoc />
    public Task RemoveAsync(string key) => cache.RemoveAsync(Prefix + key);

    private Task SaveAsync(string key, AuthenticationTicket ticket)
    {
        DateTimeOffset expires = ticket.Properties.ExpiresUtc ?? DateTimeOffset.UtcNow.Add(DefaultLifetime);
        TimeSpan lifetime = expires - DateTimeOffset.UtcNow;
        if (lifetime <= TimeSpan.Zero) lifetime = TimeSpan.FromSeconds(1);
        return cache.SetAsync(Prefix + key, TicketSerializer.Default.Serialize(ticket), new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = lifetime
        });
    }
}
