package com.teslaskin.dto;

public record LoginResponse(String token, long expiresIn, UserVO user) {
}
