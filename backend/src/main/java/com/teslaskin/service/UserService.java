package com.teslaskin.service;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.teslaskin.dto.UserVO;
import com.teslaskin.entity.User;
import com.teslaskin.exception.BizException;
import com.teslaskin.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 用户资料管理：昵称、头像
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserService {

    private final UserMapper userMapper;

    private final CosService cosService;

    /**
     * 修改昵称
     */
    public UserVO updateProfile(long uid, String nickname) {
        if (nickname == null || nickname.isBlank()) {
            throw new BizException(400, "昵称不能为空");
        }
        String trimmed = nickname.trim();
        if (trimmed.length() > 24) {
            throw new BizException(400, "昵称最多 24 字");
        }
        userMapper.update(null, new LambdaUpdateWrapper<User>()
                .eq(User::getId, uid)
                .set(User::getNickname, trimmed));
        return UserVO.from(userMapper.selectById(uid));
    }

    /**
     * 上传头像：存放到 COS 独立目录 avatars/ 下，返回新 URL 与更新后的 UserVO
     */
    public UserVO updateAvatar(long uid, byte[] bytes, String fileExt) {
        User user = userMapper.selectById(uid);
        if (user == null) {
            throw new BizException(404, "用户不存在");
        }
        String ext = normalizeExt(fileExt);
        // 头像统一存放在独立目录 avatars/ 下，文件名用 UUID 防冲突
        String key = "avatars/" + uid + "-" + UUID.randomUUID() + ext;
        String contentType = contentTypeOf(ext);
        String url = cosService.upload(bytes, key, contentType);
        userMapper.update(null, new LambdaUpdateWrapper<User>()
                .eq(User::getId, uid)
                .set(User::getAvatarUrl, url));
        log.info("用户 {} 更新头像: {}", uid, url);
        user.setAvatarUrl(url);
        return UserVO.from(user);
    }

    private String normalizeExt(String ext) {
        if (ext == null || ext.isBlank()) {
            return ".png";
        }
        ext = ext.toLowerCase().trim().replace(".", "");
        return switch (ext) {
            case "jpg", "jpeg" -> ".jpg";
            case "webp" -> ".webp";
            default -> ".png";
        };
    }

    private String contentTypeOf(String ext) {
        return switch (ext) {
            case ".jpg" -> "image/jpeg";
            case ".webp" -> "image/webp";
            default -> "image/png";
        };
    }
}
