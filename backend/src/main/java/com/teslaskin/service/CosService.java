package com.teslaskin.service;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.qcloud.cos.auth.BasicCOSCredentials;
import com.qcloud.cos.http.HttpProtocol;
import com.qcloud.cos.model.COSObject;
import com.qcloud.cos.model.CannedAccessControlList;
import com.qcloud.cos.model.GetObjectRequest;
import com.qcloud.cos.model.ObjectMetadata;
import com.qcloud.cos.model.PutObjectRequest;
import com.qcloud.cos.region.Region;
import com.teslaskin.config.CosProperties;
import com.teslaskin.exception.BizException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.util.Arrays;
import java.util.UUID;

/**
 * 腾讯云 COS 存储：密钥未配置时应用可启动，调用上传时返回明确提示
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CosService {

    private final CosProperties props;

    private volatile COSClient client;

    /**
     * 上传字节并返回公有读 URL
     */
    public String upload(byte[] bytes, String key, String contentType) {
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentLength(bytes.length);
        metadata.setContentType(contentType);
        try {
            PutObjectRequest request = new PutObjectRequest(props.getBucket(), key,
                    new ByteArrayInputStream(bytes), metadata);
            // 桶为私有读：对象级公有读，保证明文 URL 可直接访问
            request.setCannedAcl(CannedAccessControlList.PublicRead);
            client().putObject(request);
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            log.error("COS 上传失败: key={}", key, e);
            throw new BizException(500, "图片上传失败，请稍后再试");
        }
        return publicUrl(key);
    }

    /**
     * 智能抠图结果：key 供删除对象，url 供直接访问
     */
    public record MattingResult(String key, String url) {
    }

    /**
     * 智能抠图：原图经数据万象 ci-process 处理为透明背景 PNG，返回结果公有读 URL。
     * portrait=true 人像抠图(AIPortraitMatting)，false 商品/图案抠图(GoodsMatting)。
     * 前置条件：存储桶已绑定数据万象(CI)，否则 ci-process 会被忽略并原样返回原图。
     */
    public MattingResult matting(byte[] bytes, String contentType, boolean portrait) {
        String ciProcess = portrait ? "AIPortraitMatting" : "GoodsMatting";
        String uid = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String srcKey = "matting/src-" + uid + ".png";
        String finalKey = "matting/result-" + uid + ".png";
        COSClient cos = client();
        try {
            // 1. 上传原图（临时对象）
            ObjectMetadata metadata = new ObjectMetadata();
            metadata.setContentLength(bytes.length);
            metadata.setContentType(contentType != null && !contentType.isBlank() ? contentType : "image/png");
            PutObjectRequest request = new PutObjectRequest(props.getBucket(), srcKey,
                    new ByteArrayInputStream(bytes), metadata);
            cos.putObject(request);

            // 2. 下载时处理：ci-process 参数触发数据万象抠图，响应体即透明背景 PNG
            byte[] out;
            GetObjectRequest getReq = new GetObjectRequest(props.getBucket(), srcKey);
            getReq.putCustomQueryParameter("ci-process", ciProcess);
            try (COSObject obj = cos.getObject(getReq)) {
                out = obj.getObjectContent().readAllBytes();
            }
            // 桶未绑定数据万象时 ci-process 会被静默忽略并原样返回原图，此处明确报错而非把原图当结果
            if (Arrays.equals(out, bytes)) {
                throw new BizException(500, "抠图未生效：存储桶尚未绑定数据万象(CI)");
            }

            // 3. 结果转存为公有读对象
            String url = upload(out, finalKey, "image/png");
            return new MattingResult(finalKey, url);
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            log.error("智能抠图失败: portrait={}", portrait, e);
            throw new BizException(500, "抠图失败，请稍后重试或换一张更清晰的图");
        } finally {
            try {
                cos.deleteObject(props.getBucket(), srcKey);
            } catch (Exception e) {
                log.warn("清理抠图临时对象失败: key={}", srcKey, e);
            }
        }
    }

    public String publicUrl(String key) {
        String prefix = props.getUrlPrefix();
        if (prefix != null && !prefix.isBlank()) {
            return prefix.endsWith("/") ? prefix + key : prefix + "/" + key;
        }
        return "https://" + props.getBucket() + ".cos." + props.getRegion() + ".myqcloud.com/" + key;
    }

    /**
     * 删除对象：尽力而为，失败仅告警（记录已删则不阻塞业务）
     */
    public void delete(String key) {
        try {
            client().deleteObject(props.getBucket(), key);
        } catch (Exception e) {
            log.warn("COS 对象删除失败(忽略): key={}", key, e);
        }
    }

    public boolean isConfigured() {
        return props.isConfigured();
    }

    private COSClient client() {
        if (!props.isConfigured()) {
            throw new BizException(500, "COS 未配置：请在 backend/src/main/resources/application-local.yml 填写 cos.* 密钥后重启");
        }
        if (client == null) {
            synchronized (this) {
                if (client == null) {
                    BasicCOSCredentials cred = new BasicCOSCredentials(props.getSecretId(), props.getSecretKey());
                    ClientConfig cfg = new ClientConfig(new Region(props.getRegion()));
                    cfg.setHttpProtocol(HttpProtocol.https);
                    client = new COSClient(cred, cfg);
                }
            }
        }
        return client;
    }
}
