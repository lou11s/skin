package com.teslaskin.util;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

@Component
public class JwtUtil {

    private final SecretKey key;

    private final long expireDays;

    public JwtUtil(@Value("${jwt.secret}") String secret,
                   @Value("${jwt.expire-days:7}") long expireDays) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expireDays = expireDays;
    }

    public String issue(long uid) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(uid))
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expireDays, ChronoUnit.DAYS)))
                .signWith(key)
                .compact();
    }

    /**
     * 解析 token，返回 uid；非法/过期抛 JwtException
     */
    public long parse(String token) {
        Claims claims = Jwts.parser().verifyWith(key).build()
                .parseSignedClaims(token).getPayload();
        return Long.parseLong(claims.getSubject());
    }

    public long expireSeconds() {
        return Duration.ofDays(expireDays).toSeconds();
    }
}
