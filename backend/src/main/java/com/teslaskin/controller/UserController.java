package com.teslaskin.controller;

import com.teslaskin.dto.ApiResponse;
import com.teslaskin.dto.UserVO;
import com.teslaskin.exception.BizException;
import com.teslaskin.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * 用户资料：昵称、头像
 */
@RestController
@RequestMapping("/api/v1/user")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    /**
     * 修改昵称：body={"nickname":"新昵称"}
     */
    @PutMapping("/profile")
    public ApiResponse<UserVO> updateProfile(@RequestBody UpdateProfileRequest body,
                                             HttpServletRequest request) {
        long uid = requireUid(request);
        UserVO user = userService.updateProfile(uid, body.nickname());
        return ApiResponse.ok(user);
    }

    /**
     * 上传头像：multipart file 字段
     */
    @PostMapping("/avatar")
    public ApiResponse<UserVO> updateAvatar(@RequestParam("file") MultipartFile file,
                                            HttpServletRequest request) {
        if (file == null || file.isEmpty()) {
            throw new BizException(400, "请选择头像图片");
        }
        long uid = requireUid(request);
        try {
            String ext = extOf(file.getOriginalFilename());
            UserVO user = userService.updateAvatar(uid, file.getBytes(), ext);
            return ApiResponse.ok(user);
        } catch (IOException e) {
            throw new BizException(400, "读取上传文件失败");
        }
    }

    public record UpdateProfileRequest(String nickname) {
    }

    private long requireUid(HttpServletRequest request) {
        Long uid = (Long) request.getAttribute("uid");
        if (uid == null) {
            throw new BizException(401, "请先登录");
        }
        return uid;
    }

    private String extOf(String filename) {
        if (filename == null || !filename.contains(".")) {
            return "png";
        }
        return filename.substring(filename.lastIndexOf('.') + 1);
    }
}
