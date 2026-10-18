package com.teslaskin.controller;

import com.teslaskin.dto.ApiResponse;
import com.teslaskin.exception.BizException;
import com.teslaskin.service.CosService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.UUID;

/**
 * 创作辅助工具
 */
@RestController
@RequestMapping("/api/v1/tools")
@RequiredArgsConstructor
public class ToolsController {

    private static final DateTimeFormatter MONTH_FMT = DateTimeFormatter.ofPattern("yyyyMM");

    private final CosService cosService;

    /**
     * 智能抠图（腾讯云数据万象）：type=portrait 人像 / product 物品图案
     * 返回透明背景 PNG 的公有读 URL
     */
    @PostMapping("/matting")
    public ApiResponse<Map<String, String>> matting(@RequestParam("file") MultipartFile file,
                                                   @RequestParam(value = "type", defaultValue = "portrait") String type) {
        if (file == null || file.isEmpty()) {
            throw new BizException(400, "请上传图片");
        }
        if (file.getSize() > 10 * 1024 * 1024) {
            throw new BizException(400, "图片不能超过 10MB");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new BizException(400, "图片读取失败，请重试");
        }
        boolean portrait = !"product".equalsIgnoreCase(type);
        CosService.MattingResult result = cosService.matting(bytes, file.getContentType(), portrait);
        return ApiResponse.ok(Map.of("url", result.url()));
    }

    /**
     * 图层图片上传：持久化到 COS，返回公有读 URL。
     * 发布含本地临时图片的设计前调用，URL 随 designData 落库，支持作品修改时复用。
     */
    @PostMapping("/upload")
    public ApiResponse<Map<String, String>> upload(@RequestParam("file") MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BizException(400, "请上传图片");
        }
        if (file.getSize() > 10 * 1024 * 1024) {
            throw new BizException(400, "图片不能超过 10MB");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new BizException(400, "图片读取失败，请重试");
        }
        String ext = extOf(file.getOriginalFilename());
        String key = "layers/" + MONTH_FMT.format(LocalDate.now()) + "/" + UUID.randomUUID() + ext;
        String url = cosService.upload(bytes, key, file.getContentType() == null ? "image/png" : file.getContentType());
        return ApiResponse.ok(Map.of("url", url));
    }

    private String extOf(String filename) {
        if (filename == null || !filename.contains(".")) {
            return ".png";
        }
        String ext = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase().trim();
        return switch (ext) {
            case "jpg", "jpeg" -> ".jpg";
            case "webp" -> ".webp";
            default -> ".png";
        };
    }
}
