import { supabase } from "../services/supabaseClient.js";

const crearUsuario = async (req, res) => {
  const { email, password, name, last_name, birth_date, dni, role } = req.body;

  try {
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    const { error: profileError } = await supabase
      .from("user_profiles")
      .insert([
        {
          id: userId,
          email,
          name,
          last_name,
          birth_date,
          dni,
          role,
          created_at: new Date().toISOString(),
        },
      ]);

    if (profileError) {
      return res.status(400).json({ error: profileError.message });
    }

    res
      .status(201)
      .json({ mensaje: "Usuario creado correctamente", user_id: userId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
};

const loginUsuario = async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({ error: "Credenciales incorrectas" });
    }

    return res.status(200).json({
      mensaje: "Login exitoso",

      token: data.session.access_token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error en el servidor" });
  }
};

export { crearUsuario, loginUsuario };
