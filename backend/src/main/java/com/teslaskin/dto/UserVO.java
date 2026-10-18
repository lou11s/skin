package com.teslaskin.dto;

import com.teslaskin.entity.User;

public record UserVO(Long id, String nickname, String avatarUrl) {

    public static UserVO from(User user) {
        if (user == null) {
            return null;
        }
        return new UserVO(user.getId(), user.getNickname(), user.getAvatarUrl());
    }
}
