package com.teslaskin.interceptor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.teslaskin.dto.ApiResponse;
import com.teslaskin.util.JwtUtil;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.util.regex.Pattern;

/**
 * 登录拦截：放行 ping/登录/车型列表，以及游客可浏览的 GET 皮肤列表与详情
 */
@Component
@RequiredArgsConstructor
public class AuthInterceptor implements HandlerInterceptor {

    private static final Pattern SKIN_DETAIL_PATH = Pattern.compile("^/api/v1/skins/\\d+$");

    private final JwtUtil jwtUtil;

    private final ObjectMapper objectMapper;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        String path = request.getRequestURI();
        String method = request.getMethod();

        // 公开接口
        if (path.startsWith("/api/v1/auth/login")
                || path.startsWith("/api/v1/ping")
                || path.startsWith("/api/v1/car-models")) {
            return true;
        }
        // 游客可浏览：GET 广场列表 / GET 详情
        boolean isGet = HttpMethod.GET.matches(method);
        if (isGet && (path.equals("/api/v1/skins") || SKIN_DETAIL_PATH.matcher(path).matches())) {
            return true;
        }

        String auth = request.getHeader("Authorization");
        if (!StringUtils.hasText(auth) || !auth.startsWith("Bearer ")) {
            return unauthorized(response);
        }
        try {
            long uid = jwtUtil.parse(auth.substring(7));
            request.setAttribute("uid", uid);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return unauthorized(response);
        }
    }

    private boolean unauthorized(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(
                ApiResponse.error(401, "请先登录")));
        return false;
    }
}
