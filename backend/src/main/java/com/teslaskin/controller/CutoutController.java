package com.teslaskin.controller;

import com.teslaskin.dto.ApiResponse;
import com.teslaskin.dto.CutoutVO;
import com.teslaskin.exception.BizException;
import com.teslaskin.service.CutoutService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * 用户抠图库：上传任意照片抠图存库，配图时选用
 */
@RestController
@RequestMapping("/api/v1/cutouts")
@RequiredArgsConstructor
public class CutoutController {

    private final CutoutService cutoutService;

    /**
     * 我的抠图列表（新 → 旧）
     */
    @GetMapping
    public ApiResponse<List<CutoutVO>> list(HttpServletRequest request) {
        return ApiResponse.ok(cutoutService.list(requireUid(request)));
    }

    /**
     * 上传入库：type=portrait 人像抠图 / product 物品图案抠图 / plain 已抠好的透明图免抠直存
     */
    @PostMapping
    public ApiResponse<CutoutVO> create(@RequestParam("file") MultipartFile file,
                                        @RequestParam(value = "type", defaultValue = "portrait") String type,
                                        HttpServletRequest request) {
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
        return ApiResponse.ok(cutoutService.create(requireUid(request), bytes, file.getContentType(), type));
    }

    /**
     * 删除抠图（含 COS 对象）
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> remove(@PathVariable("id") long id, HttpServletRequest request) {
        cutoutService.remove(requireUid(request), id);
        return ApiResponse.ok();
    }

    private long requireUid(HttpServletRequest request) {
        Long uid = (Long) request.getAttribute("uid");
        if (uid == null) {
            throw new BizException(401, "请先登录");
        }
        return uid;
    }
}
