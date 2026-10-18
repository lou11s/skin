package com.teslaskin.controller;

import com.teslaskin.dto.ApiResponse;
import com.teslaskin.dto.PageVO;
import com.teslaskin.dto.SkinDetailVO;
import com.teslaskin.dto.SkinItemVO;
import com.teslaskin.exception.BizException;
import com.teslaskin.service.SkinService;
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

@RestController
@RequestMapping("/api/v1/skins")
@RequiredArgsConstructor
public class SkinController {

    private final SkinService skinService;

    /**
     * 创建：mode=crop 裁剪后上传（默认）；mode=direct 原图即成品直接上传
     * designData：逐面配图的设计数据 JSON（可选），保存后支持作品修改
     */
    @PostMapping
    public ApiResponse<SkinDetailVO> create(@RequestParam("file") MultipartFile file,
                                            @RequestParam("carModelId") Long carModelId,
                                            @RequestParam("title") String title,
                                            @RequestParam(value = "mode", defaultValue = "crop") String mode,
                                            @RequestParam(value = "designData", required = false) String designData,
                                            HttpServletRequest request) {
        if (title == null || title.isBlank()) {
            throw new BizException(400, "标题不能为空");
        }
        if (title.length() > 60) {
            throw new BizException(400, "标题最多 60 字");
        }
        if (!"crop".equals(mode) && !"direct".equals(mode)) {
            throw new BizException(400, "mode 仅支持 crop / direct");
        }
        checkFile(file);
        long uid = requireUid(request);
        try {
            String ext = extOf(file.getOriginalFilename());
            SkinDetailVO detail = skinService.create(uid, file.getBytes(), carModelId, title.trim(), ext,
                    "direct".equals(mode), designData);
            return ApiResponse.ok(detail);
        } catch (IOException e) {
            throw new BizException(400, "读取上传文件失败");
        }
    }

    /**
     * 修改作品（仅作者）：新成品图覆盖原作品，状态保持不变
     */
    @PostMapping("/{id}/update")
    public ApiResponse<SkinDetailVO> updateMySkin(@PathVariable long id,
                                                   @RequestParam("file") MultipartFile file,
                                                   @RequestParam("carModelId") Long carModelId,
                                                   @RequestParam("title") String title,
                                                   @RequestParam(value = "designData", required = false) String designData,
                                                   HttpServletRequest request) {
        if (title == null || title.isBlank()) {
            throw new BizException(400, "标题不能为空");
        }
        if (title.length() > 60) {
            throw new BizException(400, "标题最多 60 字");
        }
        checkFile(file);
        long uid = requireUid(request);
        try {
            String ext = extOf(file.getOriginalFilename());
            SkinDetailVO detail = skinService.updateMySkin(uid, id, file.getBytes(), carModelId,
                    title.trim(), ext, designData);
            return ApiResponse.ok(detail);
        } catch (IOException e) {
            throw new BizException(400, "读取上传文件失败");
        }
    }

    /**
     * 详情（作者可查自己的非正常态作品，用于编辑恢复设计数据）
     */
    @GetMapping("/{id}")
    public ApiResponse<SkinDetailVO> detail(@PathVariable long id, HttpServletRequest request) {
        Long uid = (Long) request.getAttribute("uid");
        return ApiResponse.ok(skinService.detail(id, uid));
    }

    /**
     * 我的作品列表（分页）
     */
    @GetMapping("/mine")
    public ApiResponse<PageVO<SkinItemVO>> mine(@RequestParam(defaultValue = "1") long page,
                                                 @RequestParam(defaultValue = "10") long size,
                                                 HttpServletRequest request) {
        long uid = requireUid(request);
        return ApiResponse.ok(skinService.mine(uid, page, size));
    }

    /**
     * 删除作品
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable long id, HttpServletRequest request) {
        long uid = requireUid(request);
        skinService.delete(uid, id);
        return ApiResponse.ok();
    }

    // ==================== 私有 ====================

    private void checkFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BizException(400, "请选择图片");
        }
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
