package com.teslaskin.service;

import com.teslaskin.exception.BizException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Map;

/**
 * 微信服务端 API：jscode2session
 */
@Slf4j
@Service
public class WxApiService {

    private final RestClient restClient = RestClient.create();

    /**
     * code 换 openid；失败抛业务异常
     */
    @SuppressWarnings("unchecked")
    public String code2openid(String appid, String secret, String code) {
        Map<String, Object> body;
        try {
            body = restClient.get()
                    .uri("https://api.weixin.qq.com/sns/jscode2session?appid={appid}&secret={secret}&js_code={code}&grant_type=authorization_code",
                            appid, secret, code)
                    .retrieve()
                    .body(Map.class);
        } catch (Exception e) {
            log.error("调用 jscode2session 失败", e);
            throw new BizException(401, "微信登录服务暂不可用，请稍后再试");
        }
        if (body == null) {
            throw new BizException(401, "微信登录失败：空响应");
        }
        Object errcode = body.get("errcode");
        if (errcode instanceof Number n && n.intValue() != 0) {
            log.warn("jscode2session 业务失败: errcode={}, errmsg={}", errcode, body.get("errmsg"));
            throw new BizException(401, "微信登录失败(" + errcode + ")：" + body.get("errmsg"));
        }
        String openid = (String) body.get("openid");
        if (openid == null || openid.isBlank()) {
            throw new BizException(401, "微信登录失败：未返回 openid");
        }
        return openid;
    }
}
