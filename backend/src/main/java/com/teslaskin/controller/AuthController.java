package com.teslaskin.controller;

import com.teslaskin.dto.ApiResponse;
import com.teslaskin.dto.LoginRequest;
import com.teslaskin.dto.LoginResponse;
import com.teslaskin.dto.UserVO;
import com.teslaskin.entity.User;
import com.teslaskin.exception.BizException;
import com.teslaskin.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return ApiResponse.ok(authService.login(request.code()));
    }

    @GetMapping("/me")
    public ApiResponse<UserVO> me(HttpServletRequest request) {
        Long uid = (Long) request.getAttribute("uid");
        if (uid == null) {
            throw new BizException(401, "请先登录");
        }
        User user = authService.getCurrentUser(uid);
        if (user == null) {
            throw new BizException(401, "用户不存在，请重新登录");
        }
        return ApiResponse.ok(UserVO.from(user));
    }
}
