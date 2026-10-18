import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * 数据库初始化工具（一次性）：
 * 探测本机 MySQL root 密码（root123/root/空），建库 model 并执行 schema.sql。
 * 运行：java -cp <mysql-connector-jar> scripts/DbInit.java
 */
public class DbInit {

    public static void main(String[] args) throws Exception {
        String user = args.length > 0 ? args[0] : "photoL";
        String pwd = args.length > 1 ? args[1] : "";
        Connection conn = null;
        try {
            conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai",
                    user, pwd);
        } catch (Exception e) {
            System.err.println("连接失败: " + e.getMessage());
            System.exit(1);
        }
        System.out.println("连接成功，用户=" + user);

        String sql = Files.readString(Path.of("src/main/resources/schema.sql"));
        List<String> statements = split(sql);
        try (Statement st = conn.createStatement()) {
            for (String s : statements) {
                st.execute(s);
            }
        }
        System.out.println("建库建表完成，共执行 " + statements.size() + " 条语句");

        try (Statement st = conn.createStatement();
             var rs = st.executeQuery("SELECT id, code, name FROM model.car_model")) {
            while (rs.next()) {
                System.out.println("车型初始数据: id=" + rs.getLong(1) + " code=" + rs.getString(2) + " name=" + rs.getString(3));
            }
        }
        conn.close();
    }

    /** 按分号切分 SQL（跳过注释行） */
    private static List<String> split(String sql) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (String line : sql.split("\n")) {
            String t = line.trim();
            if (t.startsWith("--") || t.isEmpty()) continue;
            cur.append(line).append('\n');
            if (t.endsWith(";")) {
                String s = cur.toString().trim();
                out.add(s.substring(0, s.length() - 1));
                cur.setLength(0);
            }
        }
        if (cur.length() > 0 && !cur.toString().trim().isEmpty()) {
            out.add(cur.toString().trim());
        }
        return out;
    }
}
