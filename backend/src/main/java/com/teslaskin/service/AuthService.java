package com.teslaskin.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.teslaskin.config.WxProperties;
import com.teslaskin.dto.LoginResponse;
import com.teslaskin.dto.UserVO;
import com.teslaskin.entity.User;
import com.teslaskin.mapper.UserMapper;
import com.teslaskin.util.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
@RequiredArgsConstructor
public class AuthService {

    /** 开发期固定 mock 身份：多次登录同一用户，保证"我的作品"连续 */
    private static final String MOCK_OPENID = "mock_dev_user";

    private final UserMapper userMapper;

    private final WxApiService wxApiService;

    private final WxProperties wxProperties;

    private final JwtUtil jwtUtil;

    public LoginResponse login(String code) {
        String openid;
        if (wxProperties.isMockEnabled()
                || !StringUtils.hasText(wxProperties.getAppid())
                || !StringUtils.hasText(wxProperties.getSecret())) {
            openid = MOCK_OPENID;
        } else {
            openid = wxApiService.code2openid(wxProperties.getAppid(), wxProperties.getSecret(), code);
        }
        User user = getOrCreate(openid);
        return new LoginResponse(jwtUtil.issue(user.getId()), jwtUtil.expireSeconds(), UserVO.from(user));
    }

    public User getCurrentUser(long uid) {
        return userMapper.selectById(uid);
    }

    private User getOrCreate(String openid) {
        User user = userMapper.selectOne(new LambdaQueryWrapper<User>().eq(User::getOpenid, openid));
        if (user == null) {
            user = new User();
            user.setOpenid(openid);
            user.setNickname("车友" + String.format("%06d", (int) (System.currentTimeMillis() % 1000000)));
            user.setStatus(1);
            userMapper.insert(user);
        }
        return user;
    }
}
